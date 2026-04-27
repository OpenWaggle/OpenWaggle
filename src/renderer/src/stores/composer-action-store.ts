import { create } from 'zustand'
import { useComposerStore } from './composer-store'

export type ComposerActionDialogKind =
  | 'create-branch'
  | 'rename-branch'
  | 'delete-branch'
  | 'set-upstream'

interface ComposerActionState {
  // Action dialog
  actionDialog: ComposerActionDialogKind | null
  actionDialogInput: string
  actionDialogError: string | null
  actionDialogBusy: boolean
  openActionDialog: (kind: ComposerActionDialogKind, initialValue?: string) => void
  closeActionDialog: () => void
  setActionDialogInput: (value: string) => void
  setActionDialogError: (error: string | null) => void
  setActionDialogBusy: (busy: boolean) => void

  // Branch picker
  branchQuery: string
  branchMessage: string | null
  setBranchQuery: (query: string) => void
  setBranchMessage: (message: string | null) => void
}

export const useComposerActionStore = create<ComposerActionState>((set, get) => ({
  actionDialog: null,
  actionDialogInput: '',
  actionDialogError: null,
  actionDialogBusy: false,
  branchQuery: '',
  branchMessage: null,

  openActionDialog(kind: ComposerActionDialogKind, initialValue = '') {
    useComposerStore.getState().openMenu(null)
    set({
      actionDialog: kind,
      actionDialogInput: initialValue,
      actionDialogError: null,
    })
  },

  closeActionDialog() {
    if (get().actionDialogBusy) return
    set({
      actionDialog: null,
      actionDialogInput: '',
      actionDialogError: null,
    })
  },

  setActionDialogInput(value: string) {
    set({ actionDialogInput: value })
  },

  setActionDialogError(error: string | null) {
    set({ actionDialogError: error })
  },

  setActionDialogBusy(busy: boolean) {
    set({ actionDialogBusy: busy })
  },

  setBranchQuery(query: string) {
    set({ branchQuery: query })
  },

  setBranchMessage(message: string | null) {
    set({ branchMessage: message })
  },
}))
