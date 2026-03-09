import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runBranchMutation } from '../git-mutation'

describe('runBranchMutation', () => {
  const setBranchMessage = vi.fn()
  const composerStore = { setBranchMessage }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears the branch message before running the action', async () => {
    const action = vi.fn().mockResolvedValue({ success: true })
    await runBranchMutation({ action, composerStore })
    expect(setBranchMessage).toHaveBeenNthCalledWith(1, null)
  })

  it('sets successMessage and calls onSuccess when action succeeds', async () => {
    const action = vi.fn().mockResolvedValue({ success: true })
    const onSuccess = vi.fn()
    await runBranchMutation({
      action,
      composerStore,
      onSuccess,
      successMessage: 'Branch created',
    })
    expect(setBranchMessage).toHaveBeenCalledWith('Branch created')
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('sets null message on success when no successMessage provided', async () => {
    const action = vi.fn().mockResolvedValue({ success: true })
    await runBranchMutation({ action, composerStore })
    // First call clears, second call sets null (no successMessage)
    expect(setBranchMessage).toHaveBeenNthCalledWith(2, null)
  })

  it('sets error message when action fails', async () => {
    const action = vi.fn().mockResolvedValue({ success: false, error: 'branch exists' })
    await runBranchMutation({ action, composerStore })
    expect(setBranchMessage).toHaveBeenCalledWith('branch exists')
  })

  it('sets fallback error message when action fails without error text', async () => {
    const action = vi.fn().mockResolvedValue({ success: false })
    await runBranchMutation({ action, composerStore })
    expect(setBranchMessage).toHaveBeenCalledWith('Operation failed')
  })

  it('does not call onSuccess when action fails', async () => {
    const action = vi.fn().mockResolvedValue({ success: false, error: 'fail' })
    const onSuccess = vi.fn()
    await runBranchMutation({ action, composerStore, onSuccess })
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
