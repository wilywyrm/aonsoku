import { useMemo } from 'react'
import { useTransliterationResolver } from '@/hooks/use-transliteration-resolver'
import { alignPronunciation } from '@/service/furigana/alignPronunciation'
import type { RubyLineModel } from '@/types/furigana'
import type { IStructuredLyric } from '@/types/responses/song'
import {
  findPronunciationByLang,
  normalizeStructuredLyric,
} from '@/utils/wordTiming'

/**
 * Build explicit per-line ruby models for the current song by overlaying the
 * resolved pronunciation track onto the main structured lyric.
 *
 * Pure glue, NO inference (no dictionary, no kuromoji, no per-character split):
 * the transliteration resolver decides WHICH overlay system to use,
 * `alignPronunciation` lays that track over the main track (cues matched by
 * START timestamp, shared kana affixes stripped), and the result is keyed by
 * MAIN line index. That index is shared by every consumer — it is
 * `normalizeStructuredLyric(structuredLyric).lines` order, which mirrors both
 * `structuredLyric.line` (what the word-level container re-normalises) and, for
 * well-formed synced lyrics, react-lrc's parsed line order — so the word-level
 * container and the line-level renderer can each look models up directly.
 *
 * Returns `undefined` (never an empty map) when no overlay is wanted, no
 * matching track exists, or no line yields ruby, so callers cleanly fall back
 * to bare text.
 */
export function useRubyModels(
  structuredLyric: IStructuredLyric | undefined,
  pronunciationLyrics: IStructuredLyric[] | undefined,
  songId: string | undefined,
): Map<number, RubyLineModel> | undefined {
  const { resolvedRubySystem } = useTransliterationResolver(
    pronunciationLyrics,
    songId,
  )

  return useMemo(() => {
    if (!resolvedRubySystem || !structuredLyric) return undefined

    const pronTrack = findPronunciationByLang(
      pronunciationLyrics,
      resolvedRubySystem,
    )
    if (!pronTrack) return undefined

    const models = alignPronunciation(
      normalizeStructuredLyric(structuredLyric),
      normalizeStructuredLyric(pronTrack),
    )

    // Drop empty-segment lines so `.size` reflects only lines that actually
    // carry ruby (keeps the line-level renderer's remount key meaningful).
    const map = new Map<number, RubyLineModel>()
    models.forEach((model, lineIdx) => {
      if (model.segments.length > 0) map.set(lineIdx, model)
    })
    return map.size > 0 ? map : undefined
  }, [resolvedRubySystem, structuredLyric, pronunciationLyrics])
}
