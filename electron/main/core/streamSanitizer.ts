import { net, protocol } from 'electron'
import {
  FlacStreamMeta,
  FlacTailSanitizer,
  parseStreamInfo,
  STREAM_META_HEADER_BYTES,
} from './flacTailSanitizer'

/**
 * Custom protocol that proxies Subsonic `stream` responses through the
 * FLAC tail sanitizer (see flacTailSanitizer.ts). The renderer points the
 * audio element at:
 *
 *   aonsoku-stream://flac/?src=<encodeURIComponent(realStreamUrl)>
 *
 * The proxy forwards Range headers upstream and returns the upstream
 * status and headers untouched, so seeking and Content-Length behave
 * exactly as they would when streaming directly from the server.
 *
 * Upstream lifetime management matters more than it looks: Chromium aborts
 * the media request on every seek and track change, but Electron does not
 * reliably propagate that abort to the Response body returned from
 * protocol.handle (electron#47097), and net.fetch here is limited to ~6
 * connections per host. A leaked upstream body therefore permanently eats
 * a socket, and a few seeks are enough to starve every later request to
 * the server. Three defenses below: request.signal is wired to abort the
 * upstream fetch, the response body cancels the upstream reader from its
 * cancel() callback, and a hard cap evicts the oldest active upstream.
 */
export const STREAM_SANITIZER_SCHEME = 'aonsoku-stream'

interface StreamCacheEntry {
  meta: FlacStreamMeta | null
  zeroFrom: number | null
}

const STREAM_CACHE_LIMIT = 256
const streamCache = new Map<string, StreamCacheEntry>()

function rememberStream(key: string, entry: StreamCacheEntry): void {
  if (!streamCache.has(key) && streamCache.size >= STREAM_CACHE_LIMIT) {
    const oldest = streamCache.keys().next().value
    if (oldest !== undefined) streamCache.delete(oldest)
  }
  streamCache.set(key, entry)
}

interface ActiveUpstream {
  startedAt: number
  release: () => void
  abort: () => void
}

const MAX_ACTIVE_UPSTREAMS = 4
const activeUpstreams = new Set<ActiveUpstream>()

function evictOldestUpstreams(): void {
  while (activeUpstreams.size >= MAX_ACTIVE_UPSTREAMS) {
    let oldest: ActiveUpstream | null = null
    for (const upstream of activeUpstreams) {
      if (oldest === null || upstream.startedAt < oldest.startedAt) {
        oldest = upstream
      }
    }
    if (oldest === null) return
    oldest.abort()
  }
}

/** Must be called before app 'ready'. */
export function registerStreamSanitizerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: STREAM_SANITIZER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
}

/** Must be called after app 'ready'. */
export function setupStreamSanitizer(): void {
  protocol.handle(STREAM_SANITIZER_SCHEME, handleStreamRequest)
}

async function handleStreamRequest(request: Request): Promise<Response> {
  const source = extractSourceUrl(request.url)
  if (!source) {
    return new Response('Invalid stream source', { status: 400 })
  }

  const upstreamController = new AbortController()
  const abortUpstream = () => upstreamController.abort()
  if (request.signal.aborted) {
    abortUpstream()
  } else {
    request.signal.addEventListener('abort', abortUpstream)
  }

  const upstreamHeaders = new Headers()
  const range = request.headers.get('range')
  if (range) upstreamHeaders.set('range', range)

  evictOldestUpstreams()

  let upstream: Response
  try {
    upstream = await net.fetch(source, {
      headers: upstreamHeaders,
      signal: upstreamController.signal,
    })
  } catch (error) {
    request.signal.removeEventListener('abort', abortUpstream)
    if (upstreamController.signal.aborted) {
      return new Response(null, { status: 499 })
    }
    console.error('[streamSanitizer] upstream fetch failed', error)
    return new Response('Upstream fetch failed', { status: 502 })
  }

  const responseHeaders = new Headers(upstream.headers)
  responseHeaders.set('access-control-allow-origin', '*')

  const upstreamResponse = () =>
    new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })

  if (!upstream.ok || !upstream.body) {
    request.signal.removeEventListener('abort', abortUpstream)
    return upstreamResponse()
  }

  const sanitizer = await createSanitizer(source, upstream)
  if (sanitizer === 'unsupported-range') {
    request.signal.removeEventListener('abort', abortUpstream)
    return upstreamResponse()
  }

  const reader = upstream.body.getReader()
  let released = false
  const entry: ActiveUpstream = {
    startedAt: Date.now(),
    release: () => {
      if (released) return
      released = true
      activeUpstreams.delete(entry)
      request.signal.removeEventListener('abort', abortUpstream)
    },
    abort: () => {
      entry.release()
      reader.cancel().catch(() => undefined)
      upstreamController.abort()
    },
  }
  activeUpstreams.add(entry)

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) {
            const rest = sanitizer ? sanitizer.flush() : []
            for (const buffer of rest) controller.enqueue(buffer)
            entry.release()
            controller.close()
            return
          }
          const buffers = sanitizer ? sanitizer.push(value) : [value]
          if (buffers.length > 0) {
            for (const buffer of buffers) controller.enqueue(buffer)
            return
          }
        }
      } catch (error) {
        entry.abort()
        controller.error(error)
      }
    },
    cancel() {
      entry.abort()
    },
  })

  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

/**
 * Builds the sanitizer for a stream response, or null for content that
 * should pass through untouched. Returns 'unsupported-range' for 206
 * responses whose byte offset cannot be determined.
 */
async function createSanitizer(
  source: string,
  upstream: Response,
): Promise<FlacTailSanitizer | null | 'unsupported-range'> {
  const contentType = (upstream.headers.get('content-type') ?? '').toLowerCase()
  const mayBeFlac =
    contentType === '' ||
    contentType.includes('flac') ||
    contentType.includes('octet-stream')
  if (!mayBeFlac) return null

  let baseOffset = 0
  if (upstream.status === 206) {
    const contentRange = upstream.headers.get('content-range')
    const match = contentRange?.match(/bytes\s+(\d+)-/)
    if (!match) return 'unsupported-range'
    baseOffset = Number(match[1])
  }

  let entry = streamCache.get(source)
  if (!entry) {
    entry =
      baseOffset > 0
        ? await fetchStreamMeta(source)
        : { meta: null, zeroFrom: null }
    rememberStream(source, entry)
  }

  const cacheEntry = entry
  return new FlacTailSanitizer({
    baseOffset,
    meta: cacheEntry.meta,
    zeroFrom: cacheEntry.zeroFrom,
    onMeta: (meta) => {
      cacheEntry.meta = meta
    },
    onJunkDetected: (zeroFrom) => {
      cacheEntry.zeroFrom = zeroFrom
      console.warn(
        `[streamSanitizer] junk after end of FLAC stream at byte ${zeroFrom}, zero-filling remainder`,
      )
    },
  })
}

function extractSourceUrl(requestUrl: string): string | null {
  let source: string | null
  try {
    source = new URL(requestUrl).searchParams.get('src')
  } catch {
    return null
  }
  if (!source) return null

  try {
    const parsed = new URL(source)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

/**
 * Fetches the first bytes of the file to read STREAMINFO. Needed when the
 * first request for a song is already a ranged request.
 */
async function fetchStreamMeta(source: string): Promise<StreamCacheEntry> {
  const empty: StreamCacheEntry = { meta: null, zeroFrom: null }
  try {
    const response = await net.fetch(source, {
      headers: { range: `bytes=0-${STREAM_META_HEADER_BYTES - 1}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok || !response.body) return empty

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    while (received < STREAM_META_HEADER_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
    }
    reader.cancel().catch(() => undefined)
    if (received < STREAM_META_HEADER_BYTES) return empty

    const head = Buffer.concat(chunks).subarray(0, STREAM_META_HEADER_BYTES)
    const meta = parseStreamInfo(head)
    if (!meta || meta.totalSamples === 0) return empty
    return { meta, zeroFrom: null }
  } catch {
    return empty
  }
}
