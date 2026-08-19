import type { RubyLineModel, RubyLineSegment } from '@/types/furigana'
import {
  hasKanji,
  isKanji,
  isRubyExcludedPunctuation,
  isSokuon,
  katakanaToHiragana,
} from '@/utils/kana'
import type {
  NormalizedCue,
  NormalizedStructuredLyric,
} from '@/utils/wordTiming'

// Build a per-line RubyLineModel from an explicit PRONUNCIATION track laid over
// the MAIN track — no dictionary, no inference. The two tracks live in DIFFERENT
// byte-coordinate spaces (each is its own line value), so cues are matched by
// START TIMESTAMP, never by byte offset. Byte offsets are only ever used WITHIN
// the main track to place a segment in the main line's char coordinates. The
// output feeds the existing reconcile() unchanged.
//
// Line-char coordinates below are JS string (code-unit) indices with an
// INCLUSIVE end, matching reconcile.ts / segmentScriptRuns(): the text a range
// [start, end] covers is `lineValue.slice(start, end + 1)`.

interface ByteCharMaps {
  // first UTF-8 byte of a code point -> its code-unit start index
  byteStartToChar: Map<number, number>
  // last (INCLUSIVE) UTF-8 byte of a code point -> its code-unit end index
  byteEndToChar: Map<number, number>
}

// UTF-8 byte length of a single code point (1–4).
function utf8Len(cp: number): number {
  if (cp <= 0x7f) return 1
  if (cp <= 0x7ff) return 2
  if (cp <= 0xffff) return 3
  return 4
}

// Walk `lineValue` once, recording where each code point starts and ends in both
// byte and code-unit space. Mirrors reconcile.ts's private map of the same name
// so a segment emitted here lands on the exact char coordinates reconcile()
// resolves the main cues onto.
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

interface CharRange {
  start: number
  end: number
}

// Resolve a MAIN cue onto main-line char coordinates. Clean only when both byte
// offsets land on code-point boundaries; otherwise fall back to locating the
// cue's value in the line. Returns null when neither works, so the caller simply
// emits no ruby for that cue rather than misplacing it.
function resolveCueRange(
  cue: NormalizedCue,
  lineValue: string,
  maps: ByteCharMaps,
): CharRange | null {
  if (cue.byteStart !== undefined && cue.byteEnd !== undefined) {
    const start = maps.byteStartToChar.get(cue.byteStart)
    const end = maps.byteEndToChar.get(cue.byteEnd)
    if (start !== undefined && end !== undefined && start <= end) {
      return { start, end }
    }
  }
  if (cue.value) {
    const idx = lineValue.indexOf(cue.value)
    if (idx >= 0) return { start: idx, end: idx + cue.value.length - 1 }
  }
  return null
}

// The kanji core of a (base, reading) pair after shared kana affixes are peeled
// off both ends. leadStart/coreEnd are code-unit offsets INTO `base` (inclusive
// coreEnd) so the caller can shift them into line-char space.
interface StrippedReading {
  kana: string // reading of the kanji core, in hiragana
  leadStart: number // code units skipped at the front of base
  coreEnd: number // inclusive code-unit index of the core's end in base
  nonSplittable: boolean // core spans the whole base (jukujikun / no okurigana)
}

// Peel shared leading kana and trailing okurigana off a (base, reading) pair to
// isolate the kanji that actually needs ruby. Structural only — no dictionary.
// Returns null when there is nothing to annotate (no kanji, or a pure-kana /
// pure-katakana passthrough where base already equals its reading).
function stripAffixes(base: string, reading: string): StrippedReading | null {
  // Compare in one script: katakana readings (コーヒー) collapse to hiragana.
  const hiraReading = katakanaToHiragana(reading)

  // Non-kanji base (Latin such as "A"/"yeah", or bare kana): there is no
  // okurigana to peel, so an explicit reading annotates the whole base. Emit it
  // AS-AUTHORED (never folded to hiragana) whenever it differs from the base;
  // suppress only an exact passthrough (は/は, コーヒー/コーヒー). A katakana base
  // whose reading differs (コーヒー/coffee) still gets ruby.
  if (!hasKanji(base)) {
    if (reading === base) return null
    return {
      kana: reading,
      leadStart: 0,
      coreEnd: base.length - 1,
      nonSplittable: true,
    }
  }

  // Reading identical to the base → pure passthrough, no ruby.
  if (base === hiraReading) return null

  // Peel wrapping punctuation (brackets/quotes such as 「」『』（）"") off the base
  // ONLY: it carries no reading, so the ruby must centre over the kanji inside,
  // never the punctuation. Reading indices stay put since nothing matched, which
  // is why base and reading positions are tracked separately from here on.
  let baseStart = 0
  let baseEnd = base.length - 1
  while (
    baseStart <= baseEnd &&
    isRubyExcludedPunctuation(base.codePointAt(baseStart)!)
  ) {
    baseStart++
  }
  while (
    baseEnd >= baseStart &&
    isRubyExcludedPunctuation(base.codePointAt(baseEnd)!)
  ) {
    baseEnd--
  }
  // Content bounds excluding wrapping punctuation: nonSplittable below is measured
  // against these so a bracketed jukujikun (「今日」) is not mistaken for splittable.
  const contentStart = baseStart
  const contentEnd = baseEnd

  // Strip shared leading kana (prefix okurigana such as お in お茶). Base and
  // reading advance on independent cursors because peeled punctuation shifted
  // only the base.
  let readStart = 0
  let readEnd = hiraReading.length - 1
  while (
    baseStart <= baseEnd &&
    readStart <= readEnd &&
    !isKanji(base.codePointAt(baseStart)!) &&
    base[baseStart] === hiraReading[readStart]
  ) {
    baseStart++
    readStart++
  }

  // Strip shared trailing kana (suffix okurigana such as べる in 食べる).
  while (
    baseEnd >= baseStart &&
    readEnd >= readStart &&
    !isKanji(base.codePointAt(baseEnd)!) &&
    base[baseEnd] === hiraReading[readEnd]
  ) {
    baseEnd--
    readEnd--
  }

  // Peel a trailing sokuon (小さいっ) the reading doesn't account for (焦っ+じれ):
  // a geminate marker has no standalone reading, so it stays bare beside the
  // kanji like okurigana instead of widening the ruby span. The shared-trailing
  // loop already consumed any っ the reading matches, so this only fires unmatched.
  while (baseEnd >= baseStart && isSokuon(base.codePointAt(baseEnd)!)) {
    baseEnd--
  }

  const kanjiCore = base.slice(baseStart, baseEnd + 1)
  const readingCore = hiraReading.slice(readStart, readEnd + 1)

  // Core must still contain kanji and carry a reading, else there is no ruby.
  if (!kanjiCore || !hasKanji(kanjiCore)) return null
  if (!readingCore) return null

  // A core that spans the whole CONTENT (wrapping punctuation aside) had no
  // okurigana peeled off either end, so it reads as one indivisible group
  // (jukujikun like 今日/きょう). A trimmed core has bare okurigana beside it and
  // stays splittable; reconcile handles any per-kanji placement downstream.
  const nonSplittable = baseStart === contentStart && baseEnd === contentEnd

  return { kana: readingCore, leadStart: baseStart, coreEnd: baseEnd, nonSplittable }
}

// True when a main cue's start falls inside this pron cue's span. A pron cue
// with a positive span claims every main cue starting within [start, end); a
// degenerate zero-width pron cue falls back to an exact start match.
function cueInPronSpan(mainStart: number, pron: NormalizedCue): boolean {
  if (pron.end > pron.start) {
    return mainStart >= pron.start && mainStart < pron.end
  }
  return mainStart === pron.start
}

// Overlay a pronunciation track onto the main track and emit one RubyLineModel
// per main line. For each line, pron cues are matched to main cues by start
// timestamp (a pron cue spanning several main cues yields ONE group segment over
// their union), affixes are stripped per matched (base, reading) pair, and the
// resulting kanji core is emitted in main-line char coordinates. Pure — never
// mutates its inputs.
export function alignPronunciation(
  mainTrack: NormalizedStructuredLyric,
  pronTrack: NormalizedStructuredLyric,
): RubyLineModel[] {
  return mainTrack.lines.map((mainLine, lineIdx) => {
    const pronLine = pronTrack.lines[lineIdx]
    const mainCueLine = mainLine.cueLines[0]
    if (!pronLine || !mainCueLine) return { segments: [] }

    const mainCues = mainCueLine.cues
    const pronCues = pronLine.cueLines[0]?.cues ?? []
    const lineValue = mainLine.value
    const maps = buildByteCharMaps(lineValue)

    const segments: RubyLineSegment[] = []
    // Each main cue contributes to at most one segment, so overlapping pron cues
    // can never emit duplicate ruby over the same kanji.
    const consumed = new Set<number>()

    for (const pron of pronCues) {
      const groupIdx: number[] = []
      for (let mi = 0; mi < mainCues.length; mi++) {
        if (consumed.has(mi)) continue
        if (cueInPronSpan(mainCues[mi].start, pron)) groupIdx.push(mi)
      }
      if (groupIdx.length === 0) continue

      // Union the grouped main cues' char ranges; a pron cue that spans several
      // main cues becomes a single segment over the whole run.
      let unionStart = Infinity
      let unionEnd = -Infinity
      for (const mi of groupIdx) {
        const range = resolveCueRange(mainCues[mi], lineValue, maps)
        if (!range) continue
        if (range.start < unionStart) unionStart = range.start
        if (range.end > unionEnd) unionEnd = range.end
      }
      // Consume regardless of outcome so a later pron cue can't re-claim these.
      for (const mi of groupIdx) consumed.add(mi)
      if (unionStart > unionEnd) continue // nothing resolvable → no ruby

      const base = lineValue.slice(unionStart, unionEnd + 1)
      const stripped = stripAffixes(base, pron.value)
      if (!stripped) continue // bare (kana passthrough / no kanji core)

      segments.push({
        charStart: unionStart + stripped.leadStart,
        charEnd: unionStart + stripped.coreEnd,
        kana: stripped.kana,
        nonSplittable: stripped.nonSplittable,
      })
    }

    // Keep segments left-to-right for deterministic downstream consumption.
    segments.sort((a, b) => a.charStart - b.charStart)
    return { segments }
  })
}
