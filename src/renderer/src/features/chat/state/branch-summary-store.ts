import type { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import { create } from 'zustand'

export type BranchSummaryPromptMode = 'choice' | 'custom' | 'summarizing'

export interface BranchSummaryRestoreSelection {
  readonly branchId: SessionBranchId | null
  readonly nodeId: SessionNodeId | null
}

export interface BranchSummaryPromptState {
  readonly sessionId: SessionId
  readonly projectPath: string | null
  readonly sourceNodeId: SessionNodeId
  readonly restoreSelection: BranchSummaryRestoreSelection
  readonly previousComposerText: string
  readonly draftComposerText: string
  readonly mode: BranchSummaryPromptMode
}

interface OpenBranchSummaryPromptInput {
  readonly sessionId: SessionId
  readonly projectPath: string | null
  readonly sourceNodeId: SessionNodeId
  readonly restoreSelection: BranchSummaryRestoreSelection
  readonly previousComposerText: string
  readonly draftComposerText: string
}

interface BranchSummaryStoreState {
  readonly prompt: BranchSummaryPromptState | null
  readonly openPrompt: (input: OpenBranchSummaryPromptInput) => void
  readonly startCustomPrompt: (draftComposerText: string) => void
  readonly startSummarizing: () => void
  readonly restoreChoice: () => void
  readonly clearPrompt: () => void
}

export const useBranchSummaryStore = create<BranchSummaryStoreState>((set) => ({
  prompt: null,

  openPrompt(input) {
    set({
      prompt: {
        ...input,
        mode: 'choice',
      },
    })
  },

  startCustomPrompt(draftComposerText) {
    set((state) => ({
      prompt: state.prompt
        ? {
            ...state.prompt,
            draftComposerText,
            mode: 'custom',
          }
        : null,
    }))
  },

  startSummarizing() {
    set((state) => ({
      prompt: state.prompt
        ? {
            ...state.prompt,
            mode: 'summarizing',
          }
        : null,
    }))
  },

  restoreChoice() {
    set((state) => ({
      prompt: state.prompt
        ? {
            ...state.prompt,
            mode: 'choice',
          }
        : null,
    }))
  },

  clearPrompt() {
    set({ prompt: null })
  },
}))

/**
 * The message being written while a branch summary is made, which the composer does not hold: it
 * holds the summary's instructions while they are written, and nothing once they are sent.
 */
export function customBranchSummaryDraft(sessionId: SessionId) {
  const prompt = useBranchSummaryStore.getState().prompt
  if (!prompt || String(prompt.sessionId) !== String(sessionId)) return undefined
  return prompt.mode === 'custom' || prompt.mode === 'summarizing'
    ? prompt.draftComposerText
    : undefined
}
