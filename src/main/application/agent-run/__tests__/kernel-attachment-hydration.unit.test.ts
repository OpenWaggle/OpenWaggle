import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { hydrateAgentRunPayload } from '../kernel'

const prepared = {
  id: 'attachment-immutable',
  kind: 'image' as const,
  origin: 'user-file' as const,
  name: 'evidence.png',
  path: '/source/no-longer-exists.png',
  mimeType: 'image/png',
  sizeBytes: 3,
  extractedText: '',
}

describe('Agent Run pre-hydrated attachments', () => {
  it('uses the immutable prepared source without reopening the original path', async () => {
    const result = await Effect.runPromise(
      hydrateAgentRunPayload(
        { text: 'Inspect this.', thinkingLevel: 'high', attachments: [prepared] },
        [{ ...prepared, source: { type: 'data', value: 'AQID', mimeType: 'image/png' } }],
      ),
    )

    expect(result.attachments[0]?.source).toMatchObject({ value: 'AQID' })
  })

  it('rejects a pre-hydrated source that does not match the authorized payload', async () => {
    await expect(
      Effect.runPromise(
        hydrateAgentRunPayload(
          { text: 'Inspect this.', thinkingLevel: 'high', attachments: [prepared] },
          [
            {
              ...prepared,
              id: 'attachment-other',
              source: { type: 'data', value: 'AQID', mimeType: 'image/png' },
            },
          ],
        ),
      ),
    ).rejects.toThrow('do not match')
  })
})
