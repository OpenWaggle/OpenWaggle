import type { GitCommitPayload, GitCommitResult, GitStatusSummary } from '@shared/types/git'
import { create } from 'zustand'
import { api } from '@/lib/ipc'

interface GitState {
  status: GitStatusSummary | null
  isLoading: boolean
  isCommitting: boolean
  error: string | null
  refreshStatus: (projectPath: string | null) => Promise<void>
  commit: (projectPath: string, payload: GitCommitPayload) => Promise<GitCommitResult>
}

export const useGitStore = create<GitState>((set, get) => ({
  status: null,
  isLoading: false,
  isCommitting: false,
  error: null,

  async refreshStatus(projectPath: string | null) {
    if (!projectPath) {
      set({ status: null, error: null, isLoading: false })
      return
    }

    set({ isLoading: true, error: null })
    try {
      const status = await api.getGitStatus(projectPath)
      set({ status, isLoading: false, error: null })
    } catch (err) {
      set({
        status: null,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load Git status.',
      })
    }
  },

  async commit(projectPath: string, payload: GitCommitPayload) {
    set({ isCommitting: true })
    try {
      const result = await api.commitGit(projectPath, payload)
      if (result.ok) {
        await get().refreshStatus(projectPath)
      }
      return result
    } finally {
      set({ isCommitting: false })
    }
  },
}))
