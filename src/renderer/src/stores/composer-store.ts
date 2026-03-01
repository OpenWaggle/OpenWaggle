import type { PreparedAttachment } from '@shared/types/agent'
import { create } from 'zustand'

export type ComposerActionDialogKind =
  | 'create-branch'
  | 'rename-branch'
  | 'delete-branch'
  | 'set-upstream'
  | 'confirm-full-access'

type MenuKind = 'quality' | 'execution' | 'branch' | null

interface VoicePatch {
  isListening?: boolean
  isTranscribingVoice?: boolean
  voiceError?: string | null
  voiceElapsedSeconds?: number
  voiceWaveform?: number[]
}

interface ComposerState {
  // Text input
  input: string
  cursorIndex: number
  setInput: (value: string) => void
  setCursorIndex: (index: number) => void

  // Attachments
  attachments: PreparedAttachment[]
  attachmentError: string | null
  addAttachments: (files: PreparedAttachment[]) => void
  removeAttachment: (id: string) => void
  setAttachmentError: (error: string | null) => void

  // Menu toggles (only one open at a time)
  qualityMenuOpen: boolean
  executionMenuOpen: boolean
  branchMenuOpen: boolean
  openMenu: (menu: MenuKind) => void

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

  // Voice
  isListening: boolean
  isTranscribingVoice: boolean
  voiceError: string | null
  voiceElapsedSeconds: number
  voiceWaveform: number[]
  setVoiceState: (patch: VoicePatch) => void

  // Plan mode
  planModeActive: boolean
  togglePlanMode: () => void

  // Slash skills
  slashHighlightIndex: number
  dismissedSlashToken: string | null
  setSlashHighlightIndex: (index: number) => void
  setDismissedSlashToken: (token: string | null) => void

  // Reset (on conversation switch or after send)
  reset: () => void
}

interface InitialComposerState {
  input: string
  cursorIndex: number
  attachments: PreparedAttachment[]
  attachmentError: string | null
  qualityMenuOpen: boolean
  executionMenuOpen: boolean
  branchMenuOpen: boolean
  actionDialog: ComposerActionDialogKind | null
  actionDialogInput: string
  actionDialogError: string | null
  actionDialogBusy: boolean
  branchQuery: string
  branchMessage: string | null
  planModeActive: boolean
  isListening: boolean
  isTranscribingVoice: boolean
  voiceError: string | null
  voiceElapsedSeconds: number
  voiceWaveform: number[]
  slashHighlightIndex: number
  dismissedSlashToken: string | null
}

const INITIAL_STATE: InitialComposerState = {
  input: '',
  cursorIndex: 0,
  attachments: [],
  attachmentError: null,
  qualityMenuOpen: false,
  executionMenuOpen: false,
  branchMenuOpen: false,
  actionDialog: null,
  actionDialogInput: '',
  actionDialogError: null,
  actionDialogBusy: false,
  branchQuery: '',
  branchMessage: null,
  planModeActive: false,
  isListening: false,
  isTranscribingVoice: false,
  voiceError: null,
  voiceElapsedSeconds: 0,
  voiceWaveform: [],
  slashHighlightIndex: 0,
  dismissedSlashToken: null,
}

export const useComposerStore = create<ComposerState>((set, get) => ({
  ...INITIAL_STATE,

  setInput(value: string) {
    set({ input: value })
  },

  setCursorIndex(index: number) {
    set({ cursorIndex: index })
  },

  addAttachments(files: PreparedAttachment[]) {
    set((s) => ({ attachments: [...s.attachments, ...files] }))
  },

  removeAttachment(id: string) {
    set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) }))
  },

  setAttachmentError(error: string | null) {
    set({ attachmentError: error })
  },

  openMenu(menu: MenuKind) {
    set({
      qualityMenuOpen: menu === 'quality',
      executionMenuOpen: menu === 'execution',
      branchMenuOpen: menu === 'branch',
    })
  },

  openActionDialog(kind: ComposerActionDialogKind, initialValue = '') {
    set({
      qualityMenuOpen: false,
      executionMenuOpen: false,
      branchMenuOpen: false,
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

  setVoiceState(patch: VoicePatch) {
    set((s) => ({
      isListening: patch.isListening ?? s.isListening,
      isTranscribingVoice: patch.isTranscribingVoice ?? s.isTranscribingVoice,
      voiceError: patch.voiceError !== undefined ? patch.voiceError : s.voiceError,
      voiceElapsedSeconds: patch.voiceElapsedSeconds ?? s.voiceElapsedSeconds,
      voiceWaveform: patch.voiceWaveform ?? s.voiceWaveform,
    }))
  },

  togglePlanMode() {
    set((s) => ({ planModeActive: !s.planModeActive }))
  },

  setSlashHighlightIndex(index: number) {
    set({ slashHighlightIndex: index })
  },

  setDismissedSlashToken(token: string | null) {
    set({ dismissedSlashToken: token })
  },

  reset() {
    set({
      input: '',
      cursorIndex: 0,
      attachments: [],
      attachmentError: null,
      voiceError: null,
      branchMessage: null,
      dismissedSlashToken: null,
      slashHighlightIndex: 0,
      qualityMenuOpen: false,
      executionMenuOpen: false,
      branchMenuOpen: false,
      planModeActive: false,
    })
  },
}))
