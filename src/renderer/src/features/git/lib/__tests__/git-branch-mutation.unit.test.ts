import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerActionStore } from '@/features/composer/state'
import { runBranchMutation } from '../git-branch-mutation'

describe('runBranchMutation', () => {
  beforeEach(() => {
    useComposerActionStore.setState(useComposerActionStore.getInitialState())
  })

  it('clears stale branch messages, stores success messages, and emits toasts', async () => {
    const onToast = vi.fn()
    useComposerActionStore.getState().setBranchMessage('stale')

    const result = await runBranchMutation(
      () => Promise.resolve({ ok: true, message: 'Created branch feature/test.' }),
      onToast,
    )

    expect(result).toEqual({ ok: true, message: 'Created branch feature/test.' })
    expect(useComposerActionStore.getState().branchMessage).toBe('Created branch feature/test.')
    expect(onToast).toHaveBeenCalledWith('Created branch feature/test.')
  })

  it('normalizes thrown failures into visible branch mutation results', async () => {
    const onToast = vi.fn()

    const result = await runBranchMutation(() => Promise.reject(new Error('git failed')), onToast)

    expect(result).toEqual({ ok: false, code: 'unknown', message: 'git failed' })
    expect(useComposerActionStore.getState().branchMessage).toBe('git failed')
    expect(onToast).toHaveBeenCalledWith('git failed')
  })
})
