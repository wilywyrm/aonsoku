/**
 * Convert katakana reading string (as returned by kuromoji) to hiragana.
 * Code-point shift: katakana U+30A1-U+30F6 → hiragana U+3041-U+3096 (−0x60).
 * Special cases:
 *   ー (U+30FC, katakana prolonged sound mark) → kept as-is (not a standard hiragana)
 *   ヴ (U+30F4) → ゔ (U+3094, hiragana vu)
 *   Small katakana (ァィゥェォッャュョヮヵヶ) shift correctly via −0x60
 */
export function katakanaToHiragana(s: string): string {
  let result = ''
  for (const char of s) {
    const cp = char.codePointAt(0)!
    if (cp === 0x30f4) {
      // ヴ (U+30F4) → ゔ (U+3094)
      result += String.fromCodePoint(0x3094)
    } else if (cp === 0x30fc) {
      // ー (U+30FC) → kept as-is
      result += char
    } else if (cp >= 0x30a1 && cp <= 0x30f6) {
      // Standard katakana → hiragana shift (−0x60)
      result += String.fromCodePoint(cp - 0x60)
    } else {
      // Non-katakana characters pass through unchanged
      result += char
    }
  }
  return result
}

/**
 * Returns true if the Unicode code point is a CJK unified ideograph (kanji).
 * Covers: U+4E00–9FFF (CJK Unified), U+3400–4DBF (CJK Extension A),
 *         U+20000–2A6DF (Extension B, surrogate pair range),
 *         U+F900–FAFF (CJK Compatibility Ideographs).
 */
export function isKanji(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
    (cp >= 0x20000 && cp <= 0x2a6df) || // CJK Extension B
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0x3005 && cp <= 0x3007) || // ideographic iteration marks 々〆〇
    cp === 0x303b // vertical ideographic iteration mark 〻
  )
}

/**
 * Segment a line into maximal runs of kanji vs other characters.
 * Returns an array of {kind, charStart, charEnd} (charStart/charEnd are
 * JS string indices, inclusive of the start of each code-point).
 * Surrogate pairs count as one character at their HIGH surrogate position.
 */
export function segmentScriptRuns(
  line: string,
): Array<{ kind: 'kanji' | 'other'; charStart: number; charEnd: number }> {
  const runs: Array<{
    kind: 'kanji' | 'other'
    charStart: number
    charEnd: number
  }> = []

  let i = 0
  while (i < line.length) {
    const cp = line.codePointAt(i)!
    const isCurrentKanji = isKanji(cp)
    const charStart = i

    // Advance by 1 or 2 depending on surrogate pair
    i += cp > 0xffff ? 2 : 1

    // Extend the run while the script type matches
    while (i < line.length) {
      const nextCp = line.codePointAt(i)!
      const isNextKanji = isKanji(nextCp)

      if (isNextKanji !== isCurrentKanji) {
        break
      }

      i += nextCp > 0xffff ? 2 : 1
    }

    // charEnd is the index of the last code unit in this run
    const charEnd = i - 1

    runs.push({
      kind: isCurrentKanji ? 'kanji' : 'other',
      charStart,
      charEnd,
    })
  }

  return runs
}

/** Returns true if the line contains at least one kanji character. */
export function hasKanji(line: string): boolean {
  for (const char of line) {
    const cp = char.codePointAt(0)!
    if (isKanji(cp)) {
      return true
    }
  }
  return false
}
