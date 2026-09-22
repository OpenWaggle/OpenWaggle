import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, vi } from 'vitest'
import { enqueueUserInputProjection } from '../user-input-projection'

type SessionListener = Parameters<AgentSession['subscribe']>[0]
type SessionEvent = Parameters<SessionListener>[0]

it('pairs duplicate queued text with display payloads in submission order', () => {
  let listener: SessionListener | undefined
  const appendCustomEntry = vi.fn((_customType: string, _data?: unknown) => 'projection')
  const session = {
    sessionManager: { appendCustomEntry },
    subscribe(next: SessionListener) {
      listener = next
      return () => {
        listener = undefined
      }
    },
  }
  const payload = (id: string) => ({
    text: 'Same request',
    attachments: [
      {
        id,
        kind: 'text' as const,
        name: `${id}.txt`,
        path: `/tmp/${id}.txt`,
        mimeType: 'text/plain',
        sizeBytes: 1,
        extractedText: id,
      },
    ],
  })
  const emitUserStart = (text: string) =>
    listener?.(
      fromPartial<SessionEvent>({
        type: 'message_start',
        message: { role: 'user', content: [{ type: 'text', text }] },
      }),
    )

  enqueueUserInputProjection(session, payload('first'))
  enqueueUserInputProjection(session, payload('second'))
  emitUserStart('Same request\n\n[Attachment: first.txt]\nfirst')
  emitUserStart('Same request\n\n[Attachment: second.txt]\nsecond')

  expect(appendCustomEntry.mock.calls.map((call) => call[1])).toEqual([
    expect.objectContaining({
      parts: expect.arrayContaining([
        expect.objectContaining({ attachment: expect.objectContaining({ id: 'first' }) }),
      ]),
    }),
    expect.objectContaining({
      parts: expect.arrayContaining([
        expect.objectContaining({ attachment: expect.objectContaining({ id: 'second' }) }),
      ]),
    }),
  ])
})
