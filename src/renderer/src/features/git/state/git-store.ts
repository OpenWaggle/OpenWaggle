import { match } from '@diegogbrisa/ts-match'
import type { RepositoryPath, WorkingPath } from '@shared/types/brand'
import type {
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchListResult,
  GitBranchMutationFailure,
  GitBranchMutationResult,
  GitCommitFailure,
  GitCommitPayload,
  GitCommitResult,
  GitStatusSummary,
} from '@shared/types/git'
import { create } from 'zustand'
import { api } from '@/shared/lib/ipc'

/** Status for one working tree. Keyed by Working path so sessions do not overwrite each other. */
export interface GitWorkingTreeStatus {
  readonly status: GitStatusSummary | null
  readonly isLoading: boolean
  readonly error: string | null
}

const EMPTY_WORKING_TREE_STATUS: GitWorkingTreeStatus = {
  status: null,
  isLoading: false,
  error: null,
}

interface GitState {
  /**
   * Status per Working path (ADR 0018). A single slot could not represent two
   * sessions running in two worktrees, which is exactly the case this fixes.
   */
  statusByWorkingPath: Readonly<Record<string, GitWorkingTreeStatus>>
  /**
   * Branch list is repository-level, not per session: a linked worktree shares
   * `refs/` with the primary checkout, so one slot is correct and a map would
   * duplicate identical data per session.
   */
  branches: GitBranchListResult | null
  branchesRepositoryPath: RepositoryPath | null
  isLoadingBranches: boolean
  branchesError: string | null
  isCommitting: boolean
  isBranchActionRunning: boolean
  refreshStatus: (workingPath: WorkingPath | null) => Promise<void>
  refreshBranches: (repositoryPath: RepositoryPath | null) => Promise<void>
  commit: (workingPath: WorkingPath, payload: GitCommitPayload) => Promise<GitCommitResult>
  checkoutBranch: (
    workingPath: WorkingPath,
    repositoryPath: RepositoryPath,
    payload: GitBranchCheckoutPayload,
  ) => Promise<GitBranchMutationResult>
  createBranch: (
    workingPath: WorkingPath,
    repositoryPath: RepositoryPath,
    payload: GitBranchCreatePayload,
  ) => Promise<GitBranchMutationResult>
}

/** Per-path request ids, so a slow response for one tree cannot overwrite a newer one. */
const latestStatusRequestIdByPath = new Map<string, number>()
let latestBranchesRequestId = 0

function nextStatusRequestId(workingPath: string) {
  const next = (latestStatusRequestIdByPath.get(workingPath) ?? 0) + 1
  latestStatusRequestIdByPath.set(workingPath, next)
  return next
}

function isStaleStatusRequest(workingPath: string, requestId: number) {
  return latestStatusRequestIdByPath.get(workingPath) !== requestId
}

function nextBranchesRequestId() {
  latestBranchesRequestId += 1
  return latestBranchesRequestId
}

function isStaleBranchesRequest(requestId: number) {
  return latestBranchesRequestId !== requestId
}

/** Read one working tree's status slice, defaulting to empty rather than undefined. */
export function selectWorkingTreeStatus(
  state: Pick<GitState, 'statusByWorkingPath'>,
  workingPath: string | null,
): GitWorkingTreeStatus {
  if (workingPath === null) return EMPTY_WORKING_TREE_STATUS
  return state.statusByWorkingPath[workingPath] ?? EMPTY_WORKING_TREE_STATUS
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback
}

function gitCommitFailureFromError(error: unknown): GitCommitFailure {
  return { ok: false, code: 'unknown', message: getErrorMessage(error, 'Commit failed.') }
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
  statusByWorkingPath: {},
  branches: null,
  branchesRepositoryPath: null,
  isLoadingBranches: false,
  branchesError: null,
  isCommitting: false,
  isBranchActionRunning: false,

  async refreshStatus(workingPath: WorkingPath | null) {
    if (workingPath === null) return
    const requestId = nextStatusRequestId(workingPath)
    patchWorkingTree(set, workingPath, { isLoading: true, error: null })

    try {
      const status = await api.getGitStatus(workingPath)
      if (isStaleStatusRequest(workingPath, requestId)) return
      patchWorkingTree(set, workingPath, { status, isLoading: false, error: null })
    } catch (err) {
      if (isStaleStatusRequest(workingPath, requestId)) return
      patchWorkingTree(set, workingPath, {
        status: null,
        isLoading: false,
        error: getErrorMessage(err, 'Failed to load Git status.'),
      })
    }
  },

  async refreshBranches(repositoryPath: RepositoryPath | null) {
    const requestId = nextBranchesRequestId()
    if (repositoryPath === null) {
      set({
        branches: null,
        branchesRepositoryPath: null,
        isLoadingBranches: false,
        branchesError: null,
      })
      return
    }

    set((state) => ({
      branches: state.branchesRepositoryPath === repositoryPath ? state.branches : null,
      branchesRepositoryPath: repositoryPath,
      isLoadingBranches: true,
      branchesError: null,
    }))
    try {
      const branches = await api.listGitBranches(repositoryPath)
      if (isStaleBranchesRequest(requestId)) return
      set({ branches, isLoadingBranches: false, branchesError: null })
    } catch (err) {
      if (isStaleBranchesRequest(requestId)) return
      set({
        isLoadingBranches: false,
        branchesError: getErrorMessage(err, 'Failed to load Git branches.'),
      })
    }
  },

  async commit(workingPath: WorkingPath, payload: GitCommitPayload) {
    set({ isCommitting: true })
    try {
      return await resolveGitCommitResult(api.commitGit(workingPath, payload), () =>
        get().refreshStatus(workingPath),
      )
    } finally {
      set({ isCommitting: false })
    }
  },

  async checkoutBranch(
    workingPath: WorkingPath,
    repositoryPath: RepositoryPath,
    payload: GitBranchCheckoutPayload,
  ) {
    return runBranchMutation(set, () =>
      resolveGitBranchMutationResult(api.checkoutGitBranch(workingPath, payload), () =>
        refreshAfterBranchMutation(get, workingPath, repositoryPath),
      ),
    )
  },

  async createBranch(
    workingPath: WorkingPath,
    repositoryPath: RepositoryPath,
    payload: GitBranchCreatePayload,
  ) {
    return runBranchMutation(set, () =>
      resolveGitBranchMutationResult(api.createGitBranch(workingPath, payload), () =>
        refreshAfterBranchMutation(get, workingPath, repositoryPath),
      ),
    )
  },
}))

type SetGitState = (partial: (state: GitState) => Partial<GitState>) => void

function patchWorkingTree(
  set: SetGitState,
  workingPath: string,
  patch: Partial<GitWorkingTreeStatus>,
) {
  set((state) => ({
    statusByWorkingPath: {
      ...state.statusByWorkingPath,
      [workingPath]: {
        ...(state.statusByWorkingPath[workingPath] ?? EMPTY_WORKING_TREE_STATUS),
        ...patch,
      },
    },
  }))
}

/**
 * A checkout or branch creation changes both the working tree's HEAD and the
 * repository's refs, so both slices are refreshed. Branches are listed from the
 * working path deliberately: a linked worktree shares `refs/` with the primary
 * checkout, so the list is identical and the working path is the one guaranteed to
 * exist for this session.
 */
async function refreshAfterBranchMutation(
  get: () => GitState,
  workingPath: WorkingPath,
  repositoryPath: RepositoryPath,
) {
  const refreshBranches =
    get().branchesRepositoryPath === repositoryPath
      ? get().refreshBranches(repositoryPath)
      : Promise.resolve()
  await Promise.all([get().refreshStatus(workingPath), refreshBranches])
}

async function runBranchMutation(
  set: (partial: Partial<GitState>) => void,
  run: () => Promise<GitBranchMutationResult>,
) {
  set({ isBranchActionRunning: true })
  try {
    return await run()
  } finally {
    set({ isBranchActionRunning: false })
  }
}
