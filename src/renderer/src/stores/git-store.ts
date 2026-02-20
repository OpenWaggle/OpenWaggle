import type {
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchDeletePayload,
  GitBranchListResult,
  GitBranchMutationResult,
  GitBranchRenamePayload,
  GitBranchSetUpstreamPayload,
  GitCommitPayload,
  GitCommitResult,
  GitStatusSummary,
} from '@shared/types/git'
import { create } from 'zustand'
import { api } from '@/lib/ipc'

interface GitState {
  status: GitStatusSummary | null
  branches: GitBranchListResult | null
  isLoading: boolean
  isCommitting: boolean
  isBranchActionRunning: boolean
  statusError: string | null
  branchesError: string | null
  refreshStatus: (projectPath: string | null) => Promise<void>
  refreshBranches: (projectPath: string | null) => Promise<void>
  commit: (projectPath: string, payload: GitCommitPayload) => Promise<GitCommitResult>
  checkoutBranch: (
    projectPath: string,
    payload: GitBranchCheckoutPayload,
  ) => Promise<GitBranchMutationResult>
  createBranch: (
    projectPath: string,
    payload: GitBranchCreatePayload,
  ) => Promise<GitBranchMutationResult>
  renameBranch: (
    projectPath: string,
    payload: GitBranchRenamePayload,
  ) => Promise<GitBranchMutationResult>
  deleteBranch: (
    projectPath: string,
    payload: GitBranchDeletePayload,
  ) => Promise<GitBranchMutationResult>
  setUpstream: (
    projectPath: string,
    payload: GitBranchSetUpstreamPayload,
  ) => Promise<GitBranchMutationResult>
}

export const useGitStore = create<GitState>((set, get) => ({
  status: null,
  branches: null,
  isLoading: false,
  isCommitting: false,
  isBranchActionRunning: false,
  statusError: null,
  branchesError: null,

  async refreshStatus(projectPath: string | null) {
    if (!projectPath) {
      set({ status: null, statusError: null, isLoading: false })
      return
    }

    set({ isLoading: true, statusError: null })
    try {
      const status = await api.getGitStatus(projectPath)
      set({ status, isLoading: false, statusError: null })
    } catch (err) {
      set({
        status: null,
        isLoading: false,
        statusError: err instanceof Error ? err.message : 'Failed to load Git status.',
      })
    }
  },

  async refreshBranches(projectPath: string | null) {
    if (!projectPath) {
      set({ branches: null, branchesError: null })
      return
    }

    try {
      const branches = await api.listGitBranches(projectPath)
      set({ branches, branchesError: null })
    } catch (err) {
      set({
        branches: null,
        branchesError: err instanceof Error ? err.message : 'Failed to load Git branches.',
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

  async checkoutBranch(projectPath: string, payload: GitBranchCheckoutPayload) {
    set({ isBranchActionRunning: true })
    try {
      const result = await api.checkoutGitBranch(projectPath, payload)
      if (result.ok) {
        await Promise.all([get().refreshStatus(projectPath), get().refreshBranches(projectPath)])
      }
      return result
    } finally {
      set({ isBranchActionRunning: false })
    }
  },

  async createBranch(projectPath: string, payload: GitBranchCreatePayload) {
    set({ isBranchActionRunning: true })
    try {
      const result = await api.createGitBranch(projectPath, payload)
      if (result.ok) {
        await Promise.all([get().refreshStatus(projectPath), get().refreshBranches(projectPath)])
      }
      return result
    } finally {
      set({ isBranchActionRunning: false })
    }
  },

  async renameBranch(projectPath: string, payload: GitBranchRenamePayload) {
    set({ isBranchActionRunning: true })
    try {
      const result = await api.renameGitBranch(projectPath, payload)
      if (result.ok) {
        await Promise.all([get().refreshStatus(projectPath), get().refreshBranches(projectPath)])
      }
      return result
    } finally {
      set({ isBranchActionRunning: false })
    }
  },

  async deleteBranch(projectPath: string, payload: GitBranchDeletePayload) {
    set({ isBranchActionRunning: true })
    try {
      const result = await api.deleteGitBranch(projectPath, payload)
      if (result.ok) {
        await Promise.all([get().refreshStatus(projectPath), get().refreshBranches(projectPath)])
      }
      return result
    } finally {
      set({ isBranchActionRunning: false })
    }
  },

  async setUpstream(projectPath: string, payload: GitBranchSetUpstreamPayload) {
    set({ isBranchActionRunning: true })
    try {
      const result = await api.setGitBranchUpstream(projectPath, payload)
      if (result.ok) {
        await Promise.all([get().refreshStatus(projectPath), get().refreshBranches(projectPath)])
      }
      return result
    } finally {
      set({ isBranchActionRunning: false })
    }
  },
}))
