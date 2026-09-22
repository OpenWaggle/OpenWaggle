import { createHash } from 'node:crypto'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, vi } from 'vitest'
import type { PiModel } from '../../pi-provider-catalog'
import { promptPiSession } from '../run-prompt'

type SessionListener = Parameters<AgentSession['subscribe']>[0]

it('persists clean display parts when Pi starts the image prompt', async () => {
  const appendCustomEntry = vi.fn(() => 'display-entry')
  let listener: SessionListener | undefined
  const prompt = vi.fn(async (text: string) => {
    listener?.({
      type: 'message_start',
      message: fromPartial({ role: 'user' as const, content: [{ type: 'text' as const, text }] }),
    })
  })
  const session = fromPartial<AgentSession>({
    sessionManager: fromPartial({ appendCustomEntry }),
    subscribe: (nextListener: SessionListener) => {
      listener = nextListener
      return () => {
        listener = undefined
      }
    },
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
    durableTextSha256: createHash('sha256')
      .update('Fix this layout\n\n[Attachment: screenshot.png]')
      .digest('hex'),
  })
  expect(prompt).toHaveBeenCalledWith('Fix this layout\n\n[Attachment: screenshot.png]', {
    images: [{ type: 'image', data: 'base64-image', mimeType: 'image/png' }],
  })
})

it('does not leave a display projection when Pi handles input without a user message', async () => {
  const appendCustomEntry = vi.fn(() => 'display-entry')
  const session = fromPartial<AgentSession>({
    sessionManager: fromPartial({ appendCustomEntry }),
    subscribe: () => () => undefined,
    prompt: vi.fn(async () => undefined),
  })

  await promptPiSession(session, fromPartial<PiModel>({ input: ['text'] }), {
    text: '/handled',
    thinkingLevel: 'medium',
    attachments: [],
  })

  expect(appendCustomEntry).not.toHaveBeenCalled()
})
