// Reliable, fast verification that @patdx/kuromoji + the bundled IPADIC dict
// (public/dict/kuromoji) tokenize Japanese correctly, WITHOUT a browser.
//
// Why this exists instead of a Cypress component spec:
//   Loading the ~19 MB gzipped dictionary through Cypress's HTTP proxy on a
//   headless server takes ~275 s (proxy overhead + no cross-spec caching + Vite
//   dep pre-bundling), so a browser test is slow and flaky. The same dictionary
//   loaded from the filesystem here builds in ~0.5 s and asserts real readings.
//   The browser fetch wiring in src/service/furigana/tokenizer.ts (BASE_URL +
//   DecompressionStream) is exercised by the app at runtime; downstream align
//   tests inject a fake tokenizer, so no test needs the real dict in a browser.
//
// Run: pnpm verify:tokenizer   (exit 0 = pass, 1 = fail)
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { TokenizerBuilder } from '@patdx/kuromoji'

const DICT = new URL('../public/dict/kuromoji/', import.meta.url)

// The tokenizer expects the loader to return INFLATED bytes (matching the
// DecompressionStream step in tokenizer.ts). Read each shard from disk and
// gunzip it when it still carries the gzip magic bytes.
const loader = {
  async loadArrayBuffer(url) {
    let buf
    try {
      buf = readFileSync(new URL(url, DICT))
    } catch {
      buf = readFileSync(new URL(`${url}.gz`, DICT))
    }
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  },
}

const cases = [
  { line: '今日はいい天気', surface: '今日', reading: 'キョウ' },
  { line: '東京', surface: '東京', reading: 'トウキョウ' },
  { line: '食べる', surface: '食べる', reading: 'タベル' },
]

const t0 = performance.now()
const tokenizer = await new TokenizerBuilder({ loader }).build()
const buildMs = Math.round(performance.now() - t0)
console.log(`tokenizer built in ${buildMs}ms`)

let failed = 0
for (const { line, surface, reading } of cases) {
  const tokens = tokenizer.tokenize(line)
  const hit = tokens.find((x) => x.surface_form === surface)
  const ok = hit?.reading === reading
  console.log(
    `${ok ? 'PASS' : 'FAIL'} tokenize(${line}) -> ${surface}=${hit?.reading} (expected ${reading})`,
  )
  if (!ok) failed += 1
}

if (failed > 0) {
  console.log(`SMOKE_FAIL (${failed} case(s))`)
  process.exit(1)
}
console.log('SMOKE_PASS')
