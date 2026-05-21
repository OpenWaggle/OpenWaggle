import { match } from '@diegogbrisa/ts-match'
import type {
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchDeletePayload,
  GitBranchListResult,
  GitBranchMutationFailure,
  GitBranchMutationResult,
  GitBranchRenamePayload,
  GitBranchSetUpstreamPayload,
  GitCommitFailure,
  GitCommitPayload,
  GitCommitResult,
  GitStatusSummary,
} from '@shared/types/git'
import { create } from 'zustand'
import { api } from '@/shared/lib/ipc'

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

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback
}

function gitCommitFailureFromError(error: unknown): GitCommitFailure {
  return {
    ok: false,
    code: 'unknown',
    message: getErrorMessage(error, 'Commit failed.'),
  }
}

function gitBranchFailureFromError(error: unknown): GitBranchMutationFailure {
  return {
    ok: false,
    code: 'unknown',
    message: getErrorMessage(error, 'Branch operation failed.'),
  }
}

async function resolveGitCommitResult(
  resultPromise: Promise<GitCommitResult>,
  onSuccess: () => Promise<unknown>,
): Promise<GitCommitResult> {
  const result = await match
    .promise(resultPromise)
    .with({ ok: true }, async (commitResult) => {
      await onSuccess()
      return commitResult
    })
    .with({ ok: false }, (commitResult) => commitResult)
    .safeExhaustive()

  return match(result)
    .with({ ok: true }, ({ value }) => value)
    .with({ ok: false }, ({ error }) => gitCommitFailureFromError(error))
    .exhaustive()
}

async function resolveGitBranchMutationResult(
  resultPromise: Promise<GitBranchMutationResult>,
  onSuccess: () => Promise<unknown>,
): Promise<GitBranchMutationResult> {
  const result = await match
    .promise(resultPromise)
    .with({ ok: true }, async (branchResult) => {
      await onSuccess()
      return branchResult
    })
    .with({ ok: false }, (branchResult) => branchResult)
    .safeExhaustive()

  return match(result)
    .with({ ok: true }, ({ value }) => value)
    .with({ ok: false }, ({ error }) => gitBranchFailureFromError(error))
    .exhaustive()
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
      return await resolveGitCommitResult(api.commitGit(projectPath, payload), () =>
        get().refreshStatus(projectPath),
      )
    } finally {
      set({ isCommitting: false })
    }
  },

  async checkoutBranch(projectPath: string, payload: GitBranchCheckoutPayload) {
    set({ isBranchActionRunning: true })
    try {
      return await resolveGitBranchMutationResult(api.checkoutGitBranch(projectPath, payload), () =>
        Promise.all([get().refreshStatus(projectPath), get().refreshBranches(projectPath)]),
      )
    } finally {
      set({ isBranchActionRunning: false })
    }
  },

  async createBranch(projectPath: string, payload: GitBranchCreatePayload) {
    set({ isBranchActionRunning: true })
    try {
      return await resolveGitBranchMutationResult(api.createGitBranch(projectPath, payload), () =>
        Promise.all([get().refreshStatus(projectPath), get().refreshBranches(projectPath)]),
      )
    } finally {
      set({ isBranchActionRunning: false })
    }
  },

  async renameBranch(projectPath: string, payload: GitBranchRenamePayload) {
    set({ isBranchActionRunning: true })
    try {
      return await resolveGitBranchMutationResult(api.renameGitBranch(projectPath, payload), () =>
        Promise.all([get().refreshStatus(projectPath), get().refreshBranches(projectPath)]),
      )
    } finally {
      set({ isBranchActionRunning: false })
    }
  },

  async deleteBranch(projectPath: string, payload: GitBranchDeletePayload) {
    set({ isBranchActionRunning: true })
    try {
      return await resolveGitBranchMutationResult(api.deleteGitBranch(projectPath, payload), () =>
        Promise.all([get().refreshStatus(projectPath), get().refreshBranches(projectPath)]),
      )
    } finally {
      set({ isBranchActionRunning: false })
    }
  },

  async setUpstream(projectPath: string, payload: GitBranchSetUpstreamPayload) {
    set({ isBranchActionRunning: true })
    try {
      return await resolveGitBranchMutationResult(
        api.setGitBranchUpstream(projectPath, payload),
        () => Promise.all([get().refreshStatus(projectPath), get().refreshBranches(projectPath)]),
      )
    } finally {
      set({ isBranchActionRunning: false })
    }
  },
}))
