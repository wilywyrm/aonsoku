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

  const upstreamHeaders = new Headers()
  const range = request.headers.get('range')
  if (range) upstreamHeaders.set('range', range)

  let upstream: Response
  try {
    upstream = await net.fetch(source, { headers: upstreamHeaders })
  } catch (error) {
    console.error('[streamSanitizer] upstream fetch failed', error)
    return new Response('Upstream fetch failed', { status: 502 })
  }

  const responseHeaders = new Headers(upstream.headers)
  responseHeaders.set('access-control-allow-origin', '*')

  const passthrough = () =>
    new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })

  if (!upstream.ok || !upstream.body) return passthrough()

  const contentType = (upstream.headers.get('content-type') ?? '').toLowerCase()
  const mayBeFlac =
    contentType === '' ||
    contentType.includes('flac') ||
    contentType.includes('octet-stream')
  if (!mayBeFlac) return passthrough()

  let baseOffset = 0
  if (upstream.status === 206) {
    const contentRange = upstream.headers.get('content-range')
    const match = contentRange?.match(/bytes\s+(\d+)-/)
    if (!match) return passthrough()
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
  const sanitizer = new FlacTailSanitizer({
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

  const sanitized = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        for (const buffer of sanitizer.push(chunk)) {
          controller.enqueue(buffer)
        }
      },
      flush(controller) {
        for (const buffer of sanitizer.flush()) {
          controller.enqueue(buffer)
        }
      },
    }),
  )

  return new Response(sanitized, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
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
