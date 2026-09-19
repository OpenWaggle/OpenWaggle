import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginWorkspaceOwnerHandoff,
  deferWorkspaceOwnerReconciliation,
  isWorkspaceOwnerHandoffPending,
  subscribeWorkspaceOwnerHandoff,
} from '../workspace-owner-handoff'

describe('workspace owner handoff fence', () => {
  afterEach(() => vi.restoreAllMocks())

  it('drains both owners and notifies every subscriber despite a failed deferred reconciliation', () => {
    const error = new Error('persistent storage is full')
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const release = beginWorkspaceOwnerHandoff(
      'draft:/failed-reconcile',
      'session-failed-reconcile',
    )
    const remainingSource = vi.fn()
    const target = vi.fn()
    deferWorkspaceOwnerReconciliation('draft:/failed-reconcile', 'bad', () => {
      throw error
    })
    deferWorkspaceOwnerReconciliation('draft:/failed-reconcile', 'good', remainingSource)
    deferWorkspaceOwnerReconciliation('session-failed-reconcile', 'target', target)
    const firstListener = vi.fn()
    const lastListener = vi.fn()
    const unsubscribeFirst = subscribeWorkspaceOwnerHandoff(firstListener)
    const unsubscribeLast = subscribeWorkspaceOwnerHandoff(lastListener)
    try {
      expect(() => release(true)).not.toThrow()
      expect(isWorkspaceOwnerHandoffPending('draft:/failed-reconcile')).toBe(false)
      expect(isWorkspaceOwnerHandoffPending('session-failed-reconcile')).toBe(false)
      expect(remainingSource).toHaveBeenCalledExactlyOnceWith('session-failed-reconcile')
      expect(target).toHaveBeenCalledExactlyOnceWith('session-failed-reconcile')
      expect(firstListener).toHaveBeenCalledOnce()
      expect(lastListener).toHaveBeenCalledOnce()
      expect(report).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ errors: [error] }),
      )
      const releaseNext = beginWorkspaceOwnerHandoff(
        'draft:/failed-reconcile',
        'session-failed-reconcile',
      )
      releaseNext()
      expect(target).toHaveBeenCalledOnce()
      expect(remainingSource).toHaveBeenCalledOnce()
    } finally {
      unsubscribeFirst()
      unsubscribeLast()
      release()
    }
  })

  it('keeps acquisition releasable and all subscribers informed when a subscriber throws', () => {
    const error = new Error('subscriber failed')
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unsubscribeBad = subscribeWorkspaceOwnerHandoff(() => {
      throw error
    })
    const notified = vi.fn()
    const unsubscribeGood = subscribeWorkspaceOwnerHandoff(notified)
    let release: (() => void) | undefined
    try {
      expect(() => {
        release = beginWorkspaceOwnerHandoff('draft:/bad-listener', 'session-bad-listener')
      }).not.toThrow()
      expect(isWorkspaceOwnerHandoffPending('draft:/bad-listener')).toBe(true)
      expect(notified).toHaveBeenCalledTimes(1)
      expect(() => release?.()).not.toThrow()
      expect(isWorkspaceOwnerHandoffPending('draft:/bad-listener')).toBe(false)
      expect(notified).toHaveBeenCalledTimes(2)
      expect(report).toHaveBeenCalledTimes(2)
    } finally {
      unsubscribeBad()
      unsubscribeGood()
      release?.()
    }
  })

  it('rejects overlapping handoffs atomically and releases idempotently', () => {
    const release = beginWorkspaceOwnerHandoff('draft:/one', 'session-one')
    expect(() => beginWorkspaceOwnerHandoff('draft:/two', 'session-one')).toThrow('tabs are moving')
    expect(isWorkspaceOwnerHandoffPending('draft:/two')).toBe(false)
    expect(isWorkspaceOwnerHandoffPending('side-panel:draft:/one')).toBe(true)
    release()
    const releaseNext = beginWorkspaceOwnerHandoff('draft:/one', 'session-one')
    release()
    expect(isWorkspaceOwnerHandoffPending('session-one')).toBe(true)
    releaseNext()
    expect(isWorkspaceOwnerHandoffPending('session-one')).toBe(false)
  })
})
