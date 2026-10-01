import { SessionId, SupportedModelId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
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

const userMessage = {
  messageId: 'user-incorporated',
  parts: [{ type: 'text', text: 'Queued question' }],
  sessionNodeCreatedOrder: 7,
  durableTextSha256: 'c'.repeat(64),
}

describe('decodeActiveRunSnapshots', () => {
  it('keeps the user messages the active Run already incorporated', () => {
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
    ['a missing log order', { messageId: 'user', parts: [] }],
    ['an unknown part', { ...userMessage, parts: [{ type: 'image', data: 'base64-image' }] }],
  ])('rejects a user message with %s', (_case, invalid) => {
    expect(() => decodeActiveRunSnapshots([{ ...snapshot, userMessages: [invalid] }])).toThrow()
  })
})
