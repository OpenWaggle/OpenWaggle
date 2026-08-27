import type { PreparedAttachment } from '@shared/types/agent'
import type { WagglePreset } from '@shared/types/waggle'
import type { LexicalEditor } from 'lexical'

export type MenuKind = 'thinking' | 'execution' | 'branch' | null
export type SlashMenuFilter = 'all' | 'skills' | 'waggle'

export interface ActiveSlashCommandMatch {
  readonly query: string
  readonly token: string
}

export interface ComposerScopedDraft {
  readonly input: string
  readonly attachments: readonly PreparedAttachment[]
  readonly wagglePreset?: WagglePreset | null
}

export interface ComposerState {
  input: string
  cursorIndex: number
  setInput: (value: string) => void
  setCursorIndex: (index: number) => void
  promptHistory: readonly string[]
  historyIndex: number
  draftInput: string
  pushHistory: (text: string) => void
  historyUp: (currentInput: string) => string | null
  historyDown: () => string | null
  attachments: PreparedAttachment[]
  attachmentError: string | null
  selectedWagglePreset: WagglePreset | null
  setSelectedWagglePreset: (preset: WagglePreset | null) => void
  addAttachments: (files: PreparedAttachment[]) => void
  replaceAttachments: (files: readonly PreparedAttachment[]) => void
  removeAttachment: (id: string) => void
  setAttachmentError: (error: string | null) => void
  activeDraftContextKey: string | null
  scopedDrafts: Readonly<Record<string, ComposerScopedDraft>>
  setActiveDraftContextKey: (contextKey: string | null) => void
  switchScopedDraftContext: (
    contextKey: string,
    fallbackDraft?: ComposerScopedDraft,
    currentDraftOverride?: ComposerScopedDraft,
  ) => ComposerScopedDraft
  saveScopedDraft: (contextKey: string, draft: ComposerScopedDraft) => void
  getScopedDraft: (contextKey: string) => ComposerScopedDraft | null
  clearScopedDraft: (contextKey: string) => void
  clearScopedDraftsForSession: (sessionId: string) => void
  clearScopedDraftsForBranch: (sessionId: string, branchId: string) => void
  thinkingMenuOpen: boolean
  executionMenuOpen: boolean
  branchMenuOpen: boolean
  openMenu: (menu: MenuKind) => void
  slashHighlightIndex: number
  activeSlashCommand: ActiveSlashCommandMatch | null
  dismissedSlashToken: string | null
  slashMenuFilter: SlashMenuFilter
  setSlashHighlightIndex: (index: number) => void
  setActiveSlashCommand: (match: ActiveSlashCommandMatch | null) => void
  setDismissedSlashToken: (token: string | null) => void
  setSlashMenuFilter: (filter: SlashMenuFilter) => void
  lexicalEditor: LexicalEditor | null
  setLexicalEditor: (editor: LexicalEditor | null) => void
  reset: () => void
}

export interface InitialComposerState {
  input: string
  cursorIndex: number
  promptHistory: readonly string[]
  historyIndex: number
  draftInput: string
  attachments: PreparedAttachment[]
  attachmentError: string | null
  selectedWagglePreset: WagglePreset | null
  activeDraftContextKey: string | null
  scopedDrafts: Readonly<Record<string, ComposerScopedDraft>>
  thinkingMenuOpen: boolean
  executionMenuOpen: boolean
  branchMenuOpen: boolean
  slashHighlightIndex: number
  activeSlashCommand: ActiveSlashCommandMatch | null
  dismissedSlashToken: string | null
  slashMenuFilter: SlashMenuFilter
}

export type ComposerSet = (
  partial: Partial<ComposerState> | ((state: ComposerState) => Partial<ComposerState>),
) => void
export type ComposerGet = () => ComposerState
