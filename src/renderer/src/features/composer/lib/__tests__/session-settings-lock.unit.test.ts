import { describe, expect, it } from 'vitest'
import type { SessionFollowUpQueueItem } from '@/features/chat/hooks'
import {
  SESSION_SETTINGS_LOCKED_BY_OWN_QUEUE_REASON,
  SESSION_SETTINGS_LOCKED_REASON,
  sessionSettingsLock,
} from '../session-settings-lock'

function item(id: string, editable: boolean, held = false) {
  const result: SessionFollowUpQueueItem = {
    id,
    text: id,
    attachmentCount: 0,
    createdAt: 1,
    deliveryState: 'pending',
    attachments: [],
    editable,
    ...(held ? { editHold: { heldByCurrentUser: false, acquiredAt: 1, leaseExpiresAt: 2 } } : {}),
  }
  return result
}

function reason(items: readonly SessionFollowUpQueueItem[]) {
  return sessionSettingsLock({
    hasSession: true,
    canChange: false,
    draftMaterializing: false,
    queue: { state: 'paused', pauseReason: 'parent-limit', items },
  }).reason
}

// A queue waiting on agents' capacity still runs this user's messages, and cannot be paused.
describe('sessionSettingsLock in a queue waiting on agents’ capacity', () => {
  it('says the user’s own queued messages run first', () => {
    expect(reason([item('agents', false), item('mine', true)])).toBe(
      SESSION_SETTINGS_LOCKED_BY_OWN_QUEUE_REASON,
    )
  })

  it('counts a message adopted with Send as me as the user’s own', () => {
    const adopted = { ...item('adopted', false), callerId: 'gui:local-user' }
    expect(reason([item('agents', false), adopted])).toBe(
      SESSION_SETTINGS_LOCKED_BY_OWN_QUEUE_REASON,
    )
  })

  it.each([
    ['only agents’ messages wait', [item('agents', false)]],
    ['an edit holds the user’s message', [item('agents', false, true), item('mine', true)]],
  ])('unlocks when the Run ends if %s', (_, items) => {
    expect(reason(items)).toBe(SESSION_SETTINGS_LOCKED_REASON)
  })
})
