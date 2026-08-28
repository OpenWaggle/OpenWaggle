import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
  },
}))

import { useComposerActionStore } from '../composer-action-store'

beforeEach(() => {
  useComposerActionStore.setState({
    branchQuery: '',
    branchMessage: null,
  })
})

describe('branch picker', () => {
  it('setBranchQuery updates query', () => {
    useComposerActionStore.getState().setBranchQuery('feat')
    expect(useComposerActionStore.getState().branchQuery).toBe('feat')
  })

  it('setBranchMessage sets and clears message', () => {
    useComposerActionStore.getState().setBranchMessage('Branch created')
    expect(useComposerActionStore.getState().branchMessage).toBe('Branch created')

    useComposerActionStore.getState().setBranchMessage(null)
    expect(useComposerActionStore.getState().branchMessage).toBeNull()
  })
})
