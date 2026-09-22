import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, vi } from 'vitest'
import type { PiModel } from '../../pi-provider-catalog'
import { promptPiSession } from '../run-prompt'

it('persists clean display parts before prompting Pi with image artifacts', async () => {
  const appendCustomEntry = vi.fn(() => 'display-entry')
  const prompt = vi.fn(async () => undefined)
  const session = fromPartial<AgentSession>({
    sessionManager: fromPartial({ appendCustomEntry }),
    prompt,
  })
  const model = fromPartial<PiModel>({ input: ['text', 'image'] })
  const attachment = {
    id: 'image-1',
    kind: 'image' as const,
    origin: 'user-file' as const,
    name: 'screenshot.png',
    path: '/tmp/screenshot.png',
    mimeType: 'image/png',
    sizeBytes: 4,
    extractedText: '',
    source: { type: 'data' as const, value: 'base64-image', mimeType: 'image/png' },
  }

  await promptPiSession(session, model, {
    text: 'Fix this layout',
    thinkingLevel: 'medium',
    attachments: [attachment],
  })

  expect(appendCustomEntry).toHaveBeenCalledWith('openwaggle-user-input', {
    version: 1,
    parts: [
      { type: 'text', text: 'Fix this layout' },
      {
        type: 'attachment',
        attachment: {
          id: 'image-1',
          kind: 'image',
          origin: 'user-file',
          name: 'screenshot.png',
          path: '/tmp/screenshot.png',
          mimeType: 'image/png',
          sizeBytes: 4,
          extractedText: '',
        },
      },
    ],
  })
  expect(prompt).toHaveBeenCalledWith('Fix this layout\n\n[Attachment: screenshot.png]', {
    images: [{ type: 'image', data: 'base64-image', mimeType: 'image/png' }],
  })
})
