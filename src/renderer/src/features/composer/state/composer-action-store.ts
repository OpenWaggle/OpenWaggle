import { create } from 'zustand'

interface ComposerActionState {
  // Branch picker
  branchQuery: string
  branchMessage: string | null
  setBranchQuery: (query: string) => void
  setBranchMessage: (message: string | null) => void
}

export const useComposerActionStore = create<ComposerActionState>((set) => ({
  branchQuery: '',
  branchMessage: null,

  setBranchQuery(query: string) {
    set({ branchQuery: query })
  },

  setBranchMessage(message: string | null) {
    set({ branchMessage: message })
  },
}))
