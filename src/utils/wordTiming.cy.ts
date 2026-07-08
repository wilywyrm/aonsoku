import { normalizeStructuredLyric } from '@/utils/wordTiming'
import type { IStructuredLyric } from '@/types/responses/song'

describe('normalizeStructuredLyric', () => {
  it('sorts cues by start time in ascending order', () => {
    const raw: IStructuredLyric = {
      synced: true,
      kind: 'main',
      line: [
        {
          index: 0,
          start: 0,
          value: 'Test line',
        },
      ],
      cueLine: [
        {
          index: 0,
          value: 'Test',
          cue: [
            { start: 500, end: 600, value: 'word1' },
            { start: 0, end: 100, value: 'word0' },
            { start: 250, end: 350, value: 'word2' },
          ],
        },
      ],
    }

    const result = normalizeStructuredLyric(raw)

    expect(result.lines).to.have.lengthOf(1)
    expect(result.lines[0].cueLines).to.have.lengthOf(1)
    const cues = result.lines[0].cueLines[0].cues
    expect(cues).to.have.lengthOf(3)

    // Assert cues are sorted by start time
    const starts = cues.map((c) => c.start)
    expect(starts).to.deep.equal([0, 250, 500])
  })

  it('preserves relative order for cues with equal start times (stable sort)', () => {
    const raw: IStructuredLyric = {
      synced: true,
      kind: 'main',
      line: [
        {
          index: 0,
          start: 0,
          value: 'Test line',
        },
      ],
      cueLine: [
        {
          index: 0,
          value: 'Test',
          cue: [
            { start: 100, end: 150, value: 'A' },
            { start: 100, end: 150, value: 'B' },
            { start: 200, end: 250, value: 'C' },
          ],
        },
      ],
    }

    const result = normalizeStructuredLyric(raw)

    const cues = result.lines[0].cueLines[0].cues
    expect(cues).to.have.lengthOf(3)

    // Assert stable sort: A and B maintain their relative order
    expect(cues[0].value).to.equal('A')
    expect(cues[1].value).to.equal('B')
    expect(cues[2].value).to.equal('C')
  })
})
