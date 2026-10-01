import type { AgentSessionEvent, SessionEntry } from '@earendil-works/pi-coding-agent'
import { SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { describe, expect, it } from 'vitest'
import { createSessionListener } from '../session-listener'
import { buildUserInputProjection, enqueueUserInputProjection } from '../user-input-projection'

const TIMESTAMP = '2026-10-01T10:00:00.000Z'
const MODEL = SupportedModelId('openai/gpt-5.4')

/** A Pi session that, like Pi, notifies listeners of a `message_end` before appending the entry. */
function createFakePiSession(initialEntries: SessionEntry[] = []) {
  const entries: SessionEntry[] = [...initialEntries]
  const listeners = new Set<(event: AgentSessionEvent) => void>()
  let nextId = 0
  const leafId = () => entries.at(-1)?.id ?? null
  const sessionManager = {
    getEntries: () => [...entries],
    getLeafId: leafId,
    appendCustomEntry: (customType: string, data?: unknown) => {
      nextId += 1
      const id = `custom-${String(nextId)}`
      entries.push({
        type: 'custom',
        id,
        parentId: leafId(),
        timestamp: TIMESTAMP,
        customType,
        data,
      })
      return id
    },
  }
  const emit = (event: AgentSessionEvent) => {
    for (const listener of [...listeners]) listener(event)
  }
  return {
    entries,
    sessionManager,
    subscribe: (listener: (event: AgentSessionEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    deliverUserMessage(content: Extract<AgentSessionEvent, { type: 'message_start' }>['message']) {
      emit({ type: 'message_start', message: content })
      emit({ type: 'message_end', message: content })
      nextId += 1
      entries.push({
        type: 'message',
        id: `message-${String(nextId)}`,
        parentId: leafId(),
        timestamp: TIMESTAMP,
        message: content,
      })
    },
  }
}

function userMessageStarts(events: readonly AgentTransportEvent[]) {
  return events.flatMap((event) =>
    event.type === 'message_start' && event.role === 'user' ? [event] : [],
  )
}

const attachment = {
  id: 'attachment-1',
  kind: 'image' as const,
  origin: 'user-file' as const,
  name: 'screenshot.png',
  path: '/tmp/screenshot.png',
  mimeType: 'image/png',
  sizeBytes: 128,
  contentSha256: 'b'.repeat(64),
  extractedText: '',
}

const piUserMessage = {
  role: 'user' as const,
  content: [
    { type: 'text' as const, text: 'Fix this layout\n\n[Attachment: screenshot.png]' },
    { type: 'image' as const, data: 'base64-image', mimeType: 'image/png' },
  ],
  timestamp: 1,
}

describe('createSessionListener user messages', () => {
  it.each([
    ['before', true],
    ['after', false],
  ])(
    'publishes the persisted display projection when subscribed %s the projection queue',
    (_order, listenerFirst) => {
      const session = createFakePiSession([
        {
          type: 'message',
          id: 'earlier',
          parentId: null,
          timestamp: TIMESTAMP,
          message: { role: 'user', content: 'Earlier', timestamp: 0 },
        },
      ])
      const emitted: AgentTransportEvent[] = []
      const subscribeListener = () =>
        session.subscribe(
          createSessionListener(
            {
              model: MODEL,
              sessionEntries: session.sessionManager,
              onEvent: (event) => emitted.push(event),
            },
            'run-1',
          ),
        )
      const payload = { text: 'Fix this layout', attachments: [attachment] }
      if (listenerFirst) subscribeListener()
      enqueueUserInputProjection(session, payload)
      if (!listenerFirst) subscribeListener()

      session.deliverUserMessage(piUserMessage)

      const expected = buildUserInputProjection(
        payload,
        'Fix this layout\n\n[Attachment: screenshot.png]',
      )
      const [start] = userMessageStarts(emitted)
      expect(userMessageStarts(emitted)).toHaveLength(1)
      expect(start?.userMessage).toEqual({
        parts: [
          { type: 'text', text: 'Fix this layout' },
          { type: 'attachment', attachment },
        ],
        sessionNodeCreatedOrder: 2,
        durableTextSha256: expected.durableTextSha256,
      })
      // The event names the order the user node was appended at.
      expect(session.entries[2]?.type).toBe('message')
      expect(JSON.stringify(start)).not.toContain('base64-image')
      expect(JSON.stringify(start)).not.toContain('[Attachment:')
    },
  )

  it('falls back to Pi text without image payloads when no display projection was recorded', () => {
    const session = createFakePiSession()
    const emitted: AgentTransportEvent[] = []
    session.subscribe(
      createSessionListener(
        {
          model: MODEL,
          sessionEntries: session.sessionManager,
          onEvent: (event) => emitted.push(event),
        },
        'run-1',
      ),
    )

    session.deliverUserMessage({
      role: 'user',
      content: [
        { type: 'text', text: 'Report from a peer' },
        { type: 'image', data: 'base64-image', mimeType: 'image/png' },
      ],
      timestamp: 1,
    })

    expect(userMessageStarts(emitted).map((event) => event.userMessage)).toEqual([
      { parts: [{ type: 'text', text: 'Report from a peer' }], sessionNodeCreatedOrder: 0 },
    ])
  })

  it('does not publish user messages without the Run Session log', () => {
    const session = createFakePiSession()
    const emitted: AgentTransportEvent[] = []
    session.subscribe(
      createSessionListener({ model: MODEL, onEvent: (event) => emitted.push(event) }, 'run-1'),
    )

    session.deliverUserMessage({ role: 'user', content: 'Hello', timestamp: 1 })

    expect(emitted).toEqual([])
  })
})
