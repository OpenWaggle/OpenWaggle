import { SessionId } from '@shared/types/brand'
import { describe, expect, it, vi } from 'vitest'
import {
  acquireSessionDeletionFence,
  withSessionLineageMutation,
} from '../session-details/session-deletion-fence'

describe('Session deletion admission', () => {
  it('drains admitted writes while immediately rejecting new parent and child mutations', async () => {
    const parent = SessionId('fenced-parent')
    const child = SessionId('fenced-child')
    const gate = Promise.withResolvers<void>()
    const admitted = withSessionLineageMutation([child, parent], () => gate.promise)
    const acquired = vi.fn()
    const acquisition = acquireSessionDeletionFence(parent).then((release) => {
      acquired()
      return release
    })
    await expect(withSessionLineageMutation([parent], async () => undefined)).rejects.toThrow()
    await expect(
      withSessionLineageMutation([child, parent], async () => undefined),
    ).rejects.toThrow()
    expect(acquired).not.toHaveBeenCalled()
    await expect(
      withSessionLineageMutation([SessionId('unrelated')], async () => 42),
    ).resolves.toBe(42)
    gate.resolve()
    await admitted
    const release = await acquisition
    expect(acquired).toHaveBeenCalledOnce()
    release()
    await expect(
      withSessionLineageMutation([parent, child], async () => undefined),
    ).resolves.toBeUndefined()
  })

  it('does not deadlock when a cancelled finalizer attempts a blocked state update', async () => {
    const id = SessionId('cancelled-finalizer')
    const release = await acquireSessionDeletionFence(id)
    try {
      await expect(withSessionLineageMutation([id], async () => undefined)).rejects.toThrow(
        'Hive changes are blocked',
      )
      await expect(acquireSessionDeletionFence(id)).rejects.toThrow('already in progress')
    } finally {
      release()
    }
    const reacquired = await acquireSessionDeletionFence(id)
    release()
    await expect(withSessionLineageMutation([id], async () => undefined)).rejects.toThrow()
    reacquired()
  })

  it('drains failed mutations and admits new writes after fence release', async () => {
    const id = SessionId('failed-mutation')
    const gate = Promise.withResolvers<void>()
    const admitted = withSessionLineageMutation([id], () => gate.promise)
    const rejected = expect(admitted).rejects.toThrow('write failed')
    const acquisition = acquireSessionDeletionFence(id)
    gate.reject(new Error('write failed'))
    await rejected
    const release = await acquisition
    release()
    await expect(withSessionLineageMutation([id], async () => 'restored')).resolves.toBe('restored')
  })
})
