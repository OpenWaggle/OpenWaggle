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
    filePickerRequest: null,
    filePickerRequestRevision: 0,
  })
})

describe('session-scoped composer requests', () => {
  it('lets only the matching opened session consume a file picker request', () => {
    useComposerActionStore.getState().requestFilePicker('session-a')
    const request = useComposerActionStore.getState().filePickerRequest

    expect(request).toEqual({ id: 1, sessionId: 'session-a' })
    expect(
      request && useComposerActionStore.getState().takeFilePickerRequest(request.id, 'session-b'),
    ).toBe(false)
    expect(useComposerActionStore.getState().filePickerRequest).toBeNull()
  })

  it('consumes a matching request exactly once', () => {
    useComposerActionStore.getState().requestFilePicker('session-a')
    const request = useComposerActionStore.getState().filePickerRequest
    if (!request) throw new Error('Expected a file picker request')

    expect(useComposerActionStore.getState().takeFilePickerRequest(request.id, 'session-a')).toBe(
      true,
    )
    expect(useComposerActionStore.getState().takeFilePickerRequest(request.id, 'session-a')).toBe(
      false,
    )
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
