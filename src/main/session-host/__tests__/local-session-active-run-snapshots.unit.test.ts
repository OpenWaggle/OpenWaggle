import { SessionId, SupportedModelId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { buildUserInputProjection } from '../../adapters/pi/agent-kernel/user-input-projection'
import { decodeActiveRunSnapshots } from '../local-session-active-run-snapshots'

const snapshot = {
  activity: 'agent-run',
  sessionId: 'session-running',
  model: 'provider/model',
  mode: 'classic',
  startedAt: 1,
  activityEvents: [],
  parts: [{ type: 'text', text: 'Partial answer' }],
}

const screenshot = {
  id: 'attachment-1',
  kind: 'image' as const,
  origin: 'browser-preview' as const,
  name: 'preview.png',
  path: '/tmp/preview.png',
  mimeType: 'image/png',
  sizeBytes: 128,
  contentSha256: 'b'.repeat(64),
  extractedText: '',
}

const userMessage = {
  messageId: 'user-incorporated',
  parts: buildUserInputProjection({ text: 'Queued question', attachments: [screenshot] }).parts,
  sessionNodeCreatedOrder: 7,
  durableTextSha256: 'c'.repeat(64),
  timestamp: 12,
  afterAssistantMessageId: 'assistant-1',
}

describe('decodeActiveRunSnapshots', () => {
  it('keeps the user messages the active Run already incorporated, attachments included', () => {
    expect(decodeActiveRunSnapshots([{ ...snapshot, userMessages: [userMessage] }])).toEqual([
      {
        ...snapshot,
        sessionId: SessionId('session-running'),
        model: SupportedModelId('provider/model'),
        userMessages: [userMessage],
      },
    ])
  })

  it('omits an empty user message list', () => {
    expect(decodeActiveRunSnapshots([{ ...snapshot, userMessages: [] }])[0]).not.toHaveProperty(
      'userMessages',
    )
  })

  it.each([
    ['an unknown field', { ...userMessage, raw: 'base64-image' }],
    ['a malformed digest', { ...userMessage, durableTextSha256: 'not-a-digest' }],
    ['a missing log order', { messageId: 'user', parts: [], timestamp: 1 }],
    ['a negative log order', { ...userMessage, sessionNodeCreatedOrder: -1 }],
    ['a fractional log order', { ...userMessage, sessionNodeCreatedOrder: 1.5 }],
    ['a missing timestamp', { ...userMessage, timestamp: undefined }],
    ['an image payload part', { ...userMessage, parts: [{ type: 'image', data: 'base64' }] }],
  ])('rejects a user message with %s', (_case, invalid) => {
    expect(() => decodeActiveRunSnapshots([{ ...snapshot, userMessages: [invalid] }])).toThrow()
  })
})
