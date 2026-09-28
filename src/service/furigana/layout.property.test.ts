import { describe, expect, it } from 'vitest'
import type { RenderUnit, RubyLineSegment } from '@/types/furigana'
import { boundaryCollides, type ReadingGroup } from './grouping'
import { resolveSegmentLayout, resolveUnitLayout } from './layout'
import { buildLineRenderSpans } from './lineRuby'

// Seeded property tests for the shift-first ruby layout. Every seed in
// 1..SEEDS generates one random but realistic furigana line and each invariant
// must hold for all of them. Cases are regenerated inside every test, so a
// mutation bug in one test can't leak into another. The PRNG is deterministic:
// a failing seed reproduces exactly, and its message names the seed and line.

const SEEDS = 300
const KANJI = '一二三四五六七八九十百千心技体空海山川'
const KANA = 'あいうえおかきくけこさしすせそ'
const BARE = 'のをにはて'
const SPACES = ' \u3000'

// mulberry32: a public-domain 32-bit PRNG yielding floats in [0, 1).
function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Case {
  seed: number
  text: string
  // Word-path input, shaped like reconcile()'s output.
  units: RenderUnit[]
  // Line-path input in char order, plus the same segments shuffled.
  segments: RubyLineSegment[]
  shuffled: RubyLineSegment[]
}

// One line of 1-30 tokens, each uniformly a ruby run, a bare kana, an ASCII
// space or a full-width space. Every token is its own cue, except that a bare
// kana right after a ruby run shares that run's cue half the time (okurigana).
// A 2-kanji run with 2+ kana is splittable half the time, its reading cut at a
// random index; every other run is a non-splittable jukujikun.
function genCase(seed: number): Case {
  const rng = mulberry32(seed)
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1))
  const draw = (n: number, pool: string) =>
    Array.from({ length: n }, () => pool[int(0, pool.length - 1)]).join('')

  let text = ''
  let cue = -1
  const units: RenderUnit[] = []
  const segments: RubyLineSegment[] = []
  const tokenCount = int(1, 30)
  for (let i = 0; i < tokenCount; i++) {
    const kind = int(0, 3)
    const charStart = text.length
    const afterRuby = units[units.length - 1]?.kana !== undefined
    if (kind === 0) {
      const kanji = draw(int(1, 2), KANJI)
      const kana = draw(int(1, 6), KANA)
      const charEnd = charStart + kanji.length - 1
      const split =
        kanji.length === 2 && kana.length >= 2 && rng() < 0.5
          ? int(1, kana.length - 1)
          : 0
      text += kanji
      cue++
      const unit: RenderUnit = {
        charStart,
        charEnd,
        kanjiText: kanji,
        kana,
        nonSplittable: split === 0,
        coveringCueIdx: [cue],
        cueCharCounts: [kanji.length],
      }
      const segment: RubyLineSegment = {
        charStart,
        charEnd,
        kana,
        nonSplittable: split === 0,
      }
      if (split > 0) {
        const perKanji = () => [
          { charStart, charEnd: charStart, kana: kana.slice(0, split) },
          { charStart: charEnd, charEnd, kana: kana.slice(split) },
        ]
        unit.perKanji = perKanji()
        segment.perKanji = perKanji()
      }
      units.push(unit)
      segments.push(segment)
    } else {
      const bare = kind === 1 ? draw(1, BARE) : SPACES[kind - 2]
      if (!(kind === 1 && afterRuby && rng() < 0.5)) cue++
      text += bare
      units.push({
        charStart,
        charEnd: charStart,
        kanjiText: bare,
        kana: undefined,
        nonSplittable: false,
        coveringCueIdx: [cue],
        cueCharCounts: [1],
      })
    }
  }

  // Fisher-Yates on the same stream, so resolveSegmentLayout has to sort.
  const shuffled = [...segments]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = int(0, i)
    const swap = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = swap
  }

  return { seed, text, units, segments, shuffled }
}

function msg(c: Case, what: string): string {
  return `seed ${c.seed}: ${JSON.stringify(c.text)} (${what})`
}

// Count reading groups that are char-contiguous in the line yet still collide
// as rendered. Groups are flattened across items and sorted by absolute start,
// so neighbours inside one item and across items both count.
function residualCollisions(
  items: Array<{ groups: ReadingGroup[]; baseOffset: number }>,
  text: string,
): number {
  const flat = items
    .flatMap(({ groups, baseOffset }) =>
      groups.map((group) => ({
        start: baseOffset + group.start,
        end: baseOffset + group.end,
        group,
        baseOffset,
      })),
    )
    .sort((a, b) => a.start - b.start)
  let count = 0
  for (let i = 1; i < flat.length; i++) {
    const prev = flat[i - 1]
    const next = flat[i]
    if (prev.end + 1 !== next.start) continue
    const collides = boundaryCollides(
      { groups: [prev.group], baseOffset: prev.baseOffset },
      { groups: [next.group], baseOffset: next.baseOffset },
      text,
    )
    if (collides) count++
  }
  return count
}

function cueTotals(units: RenderUnit[]): Map<number, number> {
  const totals = new Map<number, number>()
  for (const u of units) {
    u.coveringCueIdx.forEach((cue, k) => {
      totals.set(cue, (totals.get(cue) ?? 0) + u.cueCharCounts[k])
    })
  }
  return totals
}

describe('resolveUnitLayout properties (seeds 1..300)', () => {
  it('W1: never throws; groups run parallel to units', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const c = genCase(seed)
      const run = () => resolveUnitLayout(c.units, c.text)
      expect(run, msg(c, 'W1 throws')).not.toThrow()
      const result = run()
      expect(result.groups.length, msg(c, 'W1 length')).toBe(
        result.units.length,
      )
    }
  })

  it('W2: units tile the line text exactly', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const c = genCase(seed)
      const { units } = resolveUnitLayout(c.units, c.text)
      expect(units.map((u) => u.kanjiText).join(''), msg(c, 'W2 join')).toBe(
        c.text,
      )
      expect(units[0].charStart, msg(c, 'W2 first')).toBe(0)
      units.forEach((u, i) => {
        const where = `W2 unit ${i}`
        if (i > 0) {
          expect(u.charStart, msg(c, where)).toBe(units[i - 1].charEnd + 1)
        }
        expect(u.kanjiText, msg(c, where)).toBe(
          c.text.slice(u.charStart, u.charEnd + 1),
        )
      })
      expect(units[units.length - 1].charEnd, msg(c, 'W2 last')).toBe(
        c.text.length - 1,
      )
    }
  })

  it('W3: per-cue char counts are preserved', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const c = genCase(seed)
      const before = cueTotals(c.units)
      const after = cueTotals(resolveUnitLayout(c.units, c.text).units)
      for (const [cue, total] of before) {
        expect(after.get(cue) ?? 0, msg(c, `W3 cue ${cue}`)).toBe(total)
      }
    }
  })

  it('W4: never adds units', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const c = genCase(seed)
      const { units } = resolveUnitLayout(c.units, c.text)
      expect(units.length, msg(c, 'W4')).toBeLessThanOrEqual(c.units.length)
    }
  })

  it('W5: no contiguous readings still collide', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const c = genCase(seed)
      const { units, groups } = resolveUnitLayout(c.units, c.text)
      const items = units.map((u, i) => ({
        groups: groups[i],
        baseOffset: u.charStart,
      }))
      expect(residualCollisions(items, c.text), msg(c, 'W5')).toBe(0)
    }
  })
})

describe('resolveSegmentLayout properties (seeds 1..300)', () => {
  it('L1: render spans and their cells tile the line text', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const c = genCase(seed)
      const spans = buildLineRenderSpans(c.text, { segments: c.segments })
      expect(spans.map((s) => s.text).join(''), msg(c, 'L1 join')).toBe(c.text)
      for (const span of spans) {
        if (!span.cells) continue
        expect(
          span.cells.map((cell) => cell.text).join(''),
          msg(c, `L1 cells of ${JSON.stringify(span.text)}`),
        ).toBe(span.text)
      }
    }
  })

  it('L2: no reading is silently dropped', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const c = genCase(seed)
      const spans = buildLineRenderSpans(c.text, { segments: c.segments })
      let pos = 0
      const ranges = spans.map((s) => {
        const range = { start: pos, end: pos + s.text.length - 1, kana: s.kana }
        pos += s.text.length
        return range
      })
      for (const seg of c.segments) {
        if (seg.kana === undefined) continue
        // Keep-first drops a segment that overlaps another. The generator
        // never emits overlaps, so this defensive skip is never taken.
        const overlapped = c.segments.some(
          (o) =>
            o !== seg &&
            o.charStart <= seg.charEnd &&
            seg.charStart <= o.charEnd,
        )
        if (overlapped) continue
        const where = `L2 ${seg.charStart}-${seg.charEnd} ${seg.kana}`
        const span = ranges.find(
          (r) => r.start <= seg.charStart && seg.charEnd <= r.end,
        )
        expect(span, msg(c, where)).toBeDefined()
        expect(span?.kana ?? '', msg(c, where)).toContain(seg.kana)
      }
    }
  })

  it('L3: re-resolving the result is a fixed point', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const c = genCase(seed)
      const first = resolveSegmentLayout(c.shuffled, c.text)
      const second = resolveSegmentLayout(first.segments, c.text)
      expect(second.segments, msg(c, 'L3')).toEqual(first.segments)
    }
  })

  it('L4: no contiguous readings still collide', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const c = genCase(seed)
      const { segments, groups } = resolveSegmentLayout(c.shuffled, c.text)
      const items = segments.map((_, i) => ({
        groups: groups[i],
        baseOffset: 0,
      }))
      expect(residualCollisions(items, c.text), msg(c, 'L4')).toBe(0)
    }
  })
})

describe('residualCollisions', () => {
  it('residualCollisions flags a known merge-first collision', () => {
    // The merge-first state of 妄想戦上のルーティン: せんじょう fused over
    // 戦上, never shifted or condensed against そう.
    const items = [
      { groups: [{ start: 0, end: 0, kana: 'もう' }], baseOffset: 0 },
      { groups: [{ start: 0, end: 0, kana: 'そう' }], baseOffset: 1 },
      { groups: [{ start: 0, end: 1, kana: 'せんじょう' }], baseOffset: 2 },
    ]
    expect(residualCollisions(items, '妄想戦上のルーティン')).toBe(1)
  })
})

describe('property generator', () => {
  // Guards against a vacuous generator: if no seed ever reached one of these
  // paths, the invariants above would pass without ever exercising it.
  it('reaches merges, folds, tracking, shift and splittable runs', () => {
    const hits = {
      wordMerge: 0,
      okuriganaFold: 0,
      tracking: 0,
      shift: 0,
      lineMerge: 0,
      splittable: 0,
    }
    for (let seed = 1; seed <= SEEDS; seed++) {
      const c = genCase(seed)
      const word = resolveUnitLayout(c.units, c.text)
      const line = resolveSegmentLayout(c.shuffled, c.text)
      const inside = (u: RenderUnit) =>
        c.units.filter(
          (x) => u.charStart <= x.charStart && x.charEnd <= u.charEnd,
        )
      // 2+ input ruby units inside one output unit is a merge (so the output
      // is shorter than the input). A bare unit inside a ruby unit is a fold,
      // since a merge only ever joins contiguous ruby units.
      const merged = word.units.some(
        (u) => inside(u).filter((x) => x.kana !== undefined).length >= 2,
      )
      const folded = word.units.some(
        (u) =>
          u.kana !== undefined && inside(u).some((x) => x.kana === undefined),
      )
      const groups = [...word.groups.flat(), ...line.groups.flat()]
      if (merged) hits.wordMerge++
      if (folded) hits.okuriganaFold++
      if (groups.some((g) => (g.tracking ?? 0) !== 0)) hits.tracking++
      if (groups.some((g) => (g.shift ?? 0) !== 0)) hits.shift++
      if (line.segments.length < c.segments.length) hits.lineMerge++
      if (c.segments.some((s) => s.perKanji !== undefined)) hits.splittable++
    }
    for (const [path, seeds] of Object.entries(hits)) {
      expect(seeds, `no seed reached ${path}`).toBeGreaterThan(0)
    }
  })
})
