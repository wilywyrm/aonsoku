import type {
  RenderUnit,
  RubyLineModel,
  RubyLineSegment,
} from '@/types/furigana'
import type { NormalizedCue } from '@/utils/wordTiming'

// Line-char coordinates below are JS string (code-unit) indices with an
// INCLUSIVE end, matching byteSlice() and segmentScriptRuns(): the text a range
// [start, end] covers is `lineValue.slice(start, end + 1)`.

// Resolved position of a cue in line-char space. `malformed` flags a cue whose
// byte offsets did not land on code-point boundaries (or fell out of range); it
// still yields a range so the underlying wipe keeps running, but never carries
// ruby.
interface CueCharRange {
  start: number
  end: number
  malformed: boolean
}

interface ByteCharMaps {
  // first UTF-8 byte of a code point -> its code-unit start index
  byteStartToChar: Map<number, number>
  // last (INCLUSIVE) UTF-8 byte of a code point -> its code-unit end index
  byteEndToChar: Map<number, number>
}

// UTF-8 byte length of a single code point (1–4), mirroring the encoder so the
// byte map can be built in one pass without allocating per code point.
function utf8Len(cp: number): number {
  if (cp <= 0x7f) return 1
  if (cp <= 0x7ff) return 2
  if (cp <= 0xffff) return 3
  return 4
}

// Walk `lineValue` once by code point, recording where each code point starts
// and ends in both byte and code-unit space. A well-formed cue's byteStart lands
// on some code point's first byte and its (inclusive) byteEnd on some code
// point's last byte; anything else is treated as malformed.
function buildByteCharMaps(lineValue: string): ByteCharMaps {
  const byteStartToChar = new Map<number, number>()
  const byteEndToChar = new Map<number, number>()
  let bytePos = 0
  let charPos = 0
  let i = 0
  while (i < lineValue.length) {
    const cp = lineValue.codePointAt(i)!
    const units = cp > 0xffff ? 2 : 1
    const bytes = utf8Len(cp)
    byteStartToChar.set(bytePos, charPos)
    byteEndToChar.set(bytePos + bytes - 1, charPos + units - 1)
    bytePos += bytes
    charPos += units
    i += units
  }
  return { byteStartToChar, byteEndToChar }
}

// Degrade a cue that could not be mapped cleanly to a best-effort char range so
// the wipe still has something to animate. Anchored on a valid byteStart when
// possible, else on where cue.value appears, else the line start; its width
// falls back to cue.value's length (byteSliceFallback parity).
function bestEffortRange(
  cue: NormalizedCue,
  lineValue: string,
  maps: ByteCharMaps,
): CueCharRange {
  const lastChar = Math.max(0, lineValue.length - 1)
  let start = 0
  const anchored =
    cue.byteStart !== undefined
      ? maps.byteStartToChar.get(cue.byteStart)
      : undefined
  if (anchored !== undefined) {
    start = anchored
  } else if (cue.value) {
    const idx = lineValue.indexOf(cue.value)
    if (idx >= 0) start = idx
  }
  start = Math.min(start, lastChar)
  const width = cue.value ? cue.value.length : 1
  const end = Math.min(lastChar, start + Math.max(1, width) - 1)
  return { start, end: Math.max(start, end), malformed: true }
}

// Map a cue's UTF-8 byte range onto line-char coordinates. Clean only when both
// offsets exist and land on code-point boundaries; every other case degrades to
// a best-effort (malformed) range rather than throwing.
function resolveCharRange(
  cue: NormalizedCue,
  lineValue: string,
  maps: ByteCharMaps,
): CueCharRange {
  if (cue.byteStart !== undefined && cue.byteEnd !== undefined) {
    const start = maps.byteStartToChar.get(cue.byteStart)
    const end = maps.byteEndToChar.get(cue.byteEnd)
    if (start !== undefined && end !== undefined && start <= end) {
      return { start, end, malformed: false }
    }
  }
  return bestEffortRange(cue, lineValue, maps)
}

// Inclusive-end slice in line-char coordinates.
function charSlice(lineValue: string, start: number, end: number): string {
  return lineValue.slice(start, end + 1)
}

// Two inclusive ranges overlap when neither ends before the other begins.
function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart <= bEnd && aEnd >= bStart
}

function bareUnit(
  charStart: number,
  charEnd: number,
  kanjiText: string,
  coveringCueIdx: number[],
): RenderUnit {
  return {
    charStart,
    charEnd,
    kanjiText,
    kana: undefined,
    nonSplittable: false,
    coveringCueIdx,
    cueCharCounts: [Math.max(1, charEnd - charStart + 1)],
  }
}

// Ordered indices of every clean cue whose char range overlaps this segment. For
// a jukujikun straddling a cue boundary this is [i, i + 1, …], which Task 15
// uses to time the single wipe across the group.
function coveringCueIndices(
  seg: RubyLineSegment,
  ranges: CueCharRange[],
): number[] {
  const indices: number[] = []
  for (let k = 0; k < ranges.length; k++) {
    const r = ranges[k]
    if (!r.malformed && overlaps(seg.charStart, seg.charEnd, r.start, r.end)) {
      indices.push(k)
    }
  }
  return indices
}

// Intersect a line-level ruby model with cue byte-ranges to produce per-cue
// render units. Splittable groups split at cue boundaries (each piece keeps its
// own per-kanji kana); a non-splittable jukujikun that straddles cues stays ONE
// unit spanning them; malformed/whitespace cues degrade to bare text so the wipe
// never breaks. Pure — never mutates `model` or `cues`.
export function reconcile(
  model: RubyLineModel,
  cues: NormalizedCue[],
  lineValue: string,
): RenderUnit[] {
  const maps = buildByteCharMaps(lineValue)
  const ranges = cues.map((cue) => resolveCharRange(cue, lineValue, maps))
  const units: RenderUnit[] = []
  // A non-splittable segment yields a single unit even when it straddles cues,
  // so once emitted it is skipped for every later cue it reaches into.
  const consumed = new Set<number>()

  for (let i = 0; i < cues.length; i++) {
    const range = ranges[i]
    const text = charSlice(lineValue, range.start, range.end)

    // Malformed or whitespace-only cues degrade to one bare unit: the wipe still
    // runs and no ruby is attached.
    if (range.malformed || text.trim() === '') {
      units.push(bareUnit(range.start, range.end, text, [i]))
      continue
    }

    // Walk the segments overlapping this cue left-to-right, filling any char gap
    // between them with bare units so a kana-only (segment-less) line still
    // produces a wipeable unit for every cue.
    const overlapping = model.segments
      .map((seg, si) => ({ seg, si }))
      .filter(({ seg }) =>
        overlaps(seg.charStart, seg.charEnd, range.start, range.end),
      )
      .sort((a, b) => a.seg.charStart - b.seg.charStart)

    let cursor = range.start
    for (const { seg, si } of overlapping) {
      const segStart = Math.max(range.start, seg.charStart)
      const segEnd = Math.min(range.end, seg.charEnd)
      if (segStart > cursor) {
        units.push(
          bareUnit(
            cursor,
            segStart - 1,
            charSlice(lineValue, cursor, segStart - 1),
            [i],
          ),
        )
      }
      cursor = Math.max(cursor, segEnd + 1)

      if (consumed.has(si)) continue

      if (seg.kana !== undefined) {
        // A kanji-bearing group (jukujikun OR per-kanji splittable) is ONE
        // render unit spanning every cue it overlaps, so a single wipe front
        // crosses the whole group even when a provider splits its kanji across
        // separately-timed cues. perKanji (when present) still places each
        // reading over its own kanji; cueCharCounts weights the wipe by chars
        // per covering cue (kanji are full-width, so char-share == width-share).
        const covering = coveringCueIndices(seg, ranges)
        const coveringIdx = covering.length > 0 ? covering : [i]
        units.push({
          charStart: seg.charStart,
          charEnd: seg.charEnd,
          kanjiText: charSlice(lineValue, seg.charStart, seg.charEnd),
          kana: seg.kana,
          nonSplittable: seg.nonSplittable,
          coveringCueIdx: coveringIdx,
          cueCharCounts: coveringIdx.map((c) =>
            Math.max(
              1,
              Math.min(seg.charEnd, ranges[c].end) -
                Math.max(seg.charStart, ranges[c].start) +
                1,
            ),
          ),
          perKanji: seg.perKanji?.map((pk) => ({
            charStart: pk.charStart,
            charEnd: pk.charEnd,
            kana: pk.kana,
          })),
        })
        consumed.add(si)
        continue
      }

      // Kanji-less (bare) segment inside this cue.
      units.push(
        bareUnit(segStart, segEnd, charSlice(lineValue, segStart, segEnd), [i]),
      )
    }

    // Trailing char range not covered by any segment -> bare.
    if (cursor <= range.end) {
      units.push(
        bareUnit(cursor, range.end, charSlice(lineValue, cursor, range.end), [
          i,
        ]),
      )
    }
  }

  return units
}
