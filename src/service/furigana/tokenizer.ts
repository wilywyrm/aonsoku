// FUTURE: move kuromoji to a Web Worker if init cost regresses on slow machines
// TODO: replace with Worker if main-thread jank is observed in production
import {
  type IpadicFeatures,
  type LoaderConfig,
  TokenizerBuilder,
} from '@patdx/kuromoji'

export type { IpadicFeatures }

// @patdx/kuromoji does not export the Tokenizer class, so derive its type from
// the builder's resolved value.
export type Tokenizer = Awaited<ReturnType<TokenizerBuilder['build']>>

// Dictionary shards live in public/dict/kuromoji and are served at the Vite base
// URL, which differs by context ('/' in the app, '/__cypress/src/' under
// Cypress), so resolve against import.meta.env.BASE_URL instead of a hardcoded
// absolute path.
const DICT_PATH = `${import.meta.env.BASE_URL}dict/kuromoji`

// The original kuromoji BrowserDictionaryLoader builds dictionary URLs with
// Node's `path.join`, which collapses the protocol slashes in the Electron/Vite
// renderer (e.g. 'http://host/dict/' -> 'http:/host/dict/') and breaks the
// request, while @patdx/kuromoji's built-in browser loader never inflates the
// gzip payload. So fetch each shard by full URL and inflate only when needed: a
// dev server (Cypress/Vite) returns it with Content-Encoding: gzip so the
// browser has already inflated it, whereas a file:// or plain host returns the
// raw gzip that still carries the 0x1f 0x8b magic bytes.
async function fetchShard(url: string): Promise<ArrayBufferLike> {
  const response = await fetch(`${DICT_PATH}/${url}`)
  if (!response.ok) {
    throw new Error(
      `Failed to load kuromoji dictionary '${url}': ${response.status}`,
    )
  }
  const payload = await response.arrayBuffer()
  const bytes = new Uint8Array(payload)
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    return payload
  }
  const inflated = new Response(payload).body!.pipeThrough(
    new DecompressionStream('gzip'),
  )
  return new Response(inflated).arrayBuffer()
}

// TokenizerBuilder.build() requests the dozen dictionary shards in parallel, and
// a dozen concurrent multi-megabyte requests are pathologically slow behind
// Cypress's proxy (~275s vs ~0.5s). Chain the requests through this loader so
// they run one at a time.
function createSequentialLoader(): LoaderConfig {
  let queue: Promise<unknown> = Promise.resolve()
  return {
    loadArrayBuffer(url: string): Promise<ArrayBufferLike> {
      const next = queue.then(() => fetchShard(url))
      queue = next.catch(() => undefined)
      return next
    },
  }
}

let tokenizerPromise: Promise<Tokenizer> | null = null

export function getTokenizer(): Promise<Tokenizer> {
  if (!tokenizerPromise) {
    tokenizerPromise = new TokenizerBuilder({
      loader: createSequentialLoader(),
    }).build()
  }
  return tokenizerPromise
}
