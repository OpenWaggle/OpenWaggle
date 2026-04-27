import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
  },
}))

import { useComposerActionStore } from '../composer-action-store'
import { useComposerStore } from '../composer-store'

beforeEach(() => {
  useComposerActionStore.setState({
    actionDialog: null,
    actionDialogInput: '',
    actionDialogError: null,
    actionDialogBusy: false,
    branchQuery: '',
    branchMessage: null,
  })
  useComposerStore.setState({
    thinkingMenuOpen: false,
    executionMenuOpen: false,
    branchMenuOpen: false,
  })
})

describe('action dialog', () => {
  it('openActionDialog sets kind and initial value', () => {
    useComposerActionStore.getState().openActionDialog('create-branch', 'feat/new')
    expect(useComposerActionStore.getState().actionDialog).toBe('create-branch')
    expect(useComposerActionStore.getState().actionDialogInput).toBe('feat/new')
    expect(useComposerActionStore.getState().actionDialogError).toBeNull()
  })

  it('openActionDialog closes menus via composer store', () => {
    useComposerStore.getState().openMenu('thinking')
    expect(useComposerStore.getState().thinkingMenuOpen).toBe(true)

    useComposerActionStore.getState().openActionDialog('delete-branch')
    expect(useComposerStore.getState().thinkingMenuOpen).toBe(false)
    expect(useComposerStore.getState().executionMenuOpen).toBe(false)
    expect(useComposerStore.getState().branchMenuOpen).toBe(false)
  })

  it('closeActionDialog resets dialog state when not busy', () => {
    useComposerActionStore.getState().openActionDialog('delete-branch')
    useComposerActionStore.getState().closeActionDialog()
    expect(useComposerActionStore.getState().actionDialog).toBeNull()
    expect(useComposerActionStore.getState().actionDialogInput).toBe('')
    expect(useComposerActionStore.getState().actionDialogError).toBeNull()
  })

  it('closeActionDialog does nothing when busy', () => {
    useComposerActionStore.getState().openActionDialog('rename-branch')
    useComposerActionStore.getState().setActionDialogBusy(true)
    useComposerActionStore.getState().closeActionDialog()
    expect(useComposerActionStore.getState().actionDialog).toBe('rename-branch')
  })

  it('setActionDialogInput updates input value', () => {
    useComposerActionStore.getState().setActionDialogInput('new-value')
    expect(useComposerActionStore.getState().actionDialogInput).toBe('new-value')
  })

  it('setActionDialogError sets and clears error', () => {
    useComposerActionStore.getState().setActionDialogError('Something went wrong')
    expect(useComposerActionStore.getState().actionDialogError).toBe('Something went wrong')

    useComposerActionStore.getState().setActionDialogError(null)
    expect(useComposerActionStore.getState().actionDialogError).toBeNull()
  })

  it('setActionDialogBusy sets busy state', () => {
    useComposerActionStore.getState().setActionDialogBusy(true)
    expect(useComposerActionStore.getState().actionDialogBusy).toBe(true)

    useComposerActionStore.getState().setActionDialogBusy(false)
    expect(useComposerActionStore.getState().actionDialogBusy).toBe(false)
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
