import { create } from 'zustand'

interface ComposerActionState {
  // Branch picker
  branchQuery: string
  branchMessage: string | null
  setBranchQuery: (query: string) => void
  setBranchMessage: (message: string | null) => void
  filePickerRequest: { readonly id: number; readonly sessionId: string } | null
  filePickerRequestRevision: number
  requestFilePicker: (sessionId: string) => void
  takeFilePickerRequest: (requestId: number, sessionId: string | null) => boolean
}

export const useComposerActionStore = create<ComposerActionState>((set, get) => ({
  branchQuery: '',
  branchMessage: null,
  filePickerRequest: null,
  filePickerRequestRevision: 0,

  setBranchQuery(query: string) {
    set({ branchQuery: query })
  },

  setBranchMessage(message: string | null) {
    set({ branchMessage: message })
  },

  requestFilePicker(sessionId: string) {
    set((state) => {
      const id = state.filePickerRequestRevision + 1
      return {
        filePickerRequest: { id, sessionId },
        filePickerRequestRevision: id,
      }
    })
  },

  takeFilePickerRequest(requestId: number, sessionId: string | null) {
    const request = get().filePickerRequest
    if (!request || request.id !== requestId) return false
    set({ filePickerRequest: null })
    return request.sessionId === sessionId
  },
}))
