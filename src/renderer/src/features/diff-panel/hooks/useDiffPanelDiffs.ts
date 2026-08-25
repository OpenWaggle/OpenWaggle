import { matchBy } from '@diegogbrisa/ts-match'
import type { WorkingPath } from '@shared/types/brand'
import type { GitDiffSuccess, GitFileDiff } from '@shared/types/git'
import { useEffect, useReducer, useRef } from 'react'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

interface DiffPanelState {
  readonly fileDiffs: readonly GitFileDiff[]
  readonly isLoading: boolean
  /** Message from a typed load failure; null when the last load succeeded. */
  readonly error: string | null
  /** Which ref "Automatic" resolved to, so the control can name it instead of promising it. */
  readonly resolvedBaseRef: string | null
  /** True when Automatic resolved nothing and the working-tree diff was returned instead. */
  readonly automaticFellBackToWorkingTree: boolean
}

const logger = createRendererLogger('diff-panel-diffs')
const DIFF_TRANSPORT_FAILURE_MESSAGE = 'The diff could not be loaded from the main process.'

/** Carry main's report of what Automatic resolved to, so the UI can show it. */
function loadSuccessAction(result: GitDiffSuccess): DiffPanelAction {
  return {
    type: 'load-success',
    fileDiffs: result.files,
    resolvedBaseRef: result.resolvedBaseRef ?? null,
    automaticFellBackToWorkingTree: result.automaticFellBackToWorkingTree === true,
  }
}

type DiffPanelAction =
  | { readonly type: 'clear' }
  | { readonly type: 'start-loading' }
  | {
      readonly type: 'load-success'
      readonly fileDiffs: readonly GitFileDiff[]
      readonly resolvedBaseRef: string | null
      readonly automaticFellBackToWorkingTree: boolean
    }
  | { readonly type: 'load-failure'; readonly error: string | null }

function diffPanelReducer(state: DiffPanelState, action: DiffPanelAction) {
  return matchBy(action, 'type')
    .with('clear', () => ({
      fileDiffs: [],
      isLoading: false,
      error: null,
      resolvedBaseRef: null,
      automaticFellBackToWorkingTree: false,
    }))
    .with('start-loading', () => ({
      ...state,
      isLoading: true,
      /*
       * Reset what the last load reported about Automatic. Keeping it meant the header claimed the
       * working tree was on display while a newly selected base ref was loading - two contradictory
       * statements about the same screen, which is the class of thing this reporting exists to remove.
       */
      resolvedBaseRef: null,
      automaticFellBackToWorkingTree: false,
    }))
    .with('load-success', (value) => ({
      ...state,
      fileDiffs: value.fileDiffs,
      isLoading: false,
      error: null,
      resolvedBaseRef: value.resolvedBaseRef,
      automaticFellBackToWorkingTree: value.automaticFellBackToWorkingTree,
    }))
    .with('load-failure', (value) => ({
      ...state,
      fileDiffs: [],
      isLoading: false,
      error: value.error,
      // Reset, or the base-ref label keeps naming what a previous successful load resolved.
      resolvedBaseRef: null,
      automaticFellBackToWorkingTree: false,
    }))
    .exhaustive()
}

function isStaleDiffRequest(
  requestId: number,
  latestRequestId: number,
  currentWorkingPath: string | null,
  requestedWorkingPath: string,
) {
  return requestId !== latestRequestId || currentWorkingPath !== requestedWorkingPath
}

/**
 * Load the diff for a scope, or null when this loader does not own it.
 *
 * A turn's diff comes from the checkpoint store. The mount effect skips turn scopes, but the imperative
 * refresh did not: "Try again" on a failed turn diff shelled out to `git diff` and replaced the failure
 * with the working tree's file list under the turn's label.
 */
function fetchDiffsForScope(workingPath: WorkingPath, selection: DiffScopeSelection) {
  if (selection.kind === 'turn') return null
  if (selection.kind === 'branch') {
    return api.getGitBranchDiff(workingPath, selection.baseRef ?? '')
  }
  return api.getGitDiff(workingPath)
}

/**
 * Load and refresh diffs for the active scope (working tree or branch-vs-base).
 *
 * The path is a **working path**, not a project path: for a worktree-mode session it is
 * the Session worktree. Naming it precisely matters here because reading the project
 * path instead is exactly the defect ADR 0018 fixed.
 */
export function useDiffPanelDiffs(
  workingPath: WorkingPath | null,
  selection: DiffScopeSelection,
  /**
   * Bumped to refetch. Refresh used to be implemented by remounting the whole panel, which threw
   * away everything panel-local: the scroll position in a long diff, the navigator's collapsed
   * folders, the line selection, and the commit message the user was in the middle of typing.
   */
  refreshToken = 0,
) {
  const [state, dispatch] = useReducer(diffPanelReducer, {
    fileDiffs: [],
    isLoading: false,
    error: null,
    resolvedBaseRef: null,
    automaticFellBackToWorkingTree: false,
  })
  const currentWorkingPath = useRef(workingPath)
  const diffRequestId = useRef(0)
  const selectionRef = useRef(selection)
  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  useEffect(() => {
    currentWorkingPath.current = workingPath
  }, [workingPath])

  const scopeKind = selection.kind
  const branchBaseRef = selection.kind === 'branch' ? (selection.baseRef ?? '') : ''

  useEffect(() => {
    diffRequestId.current += 1
    const requestId = diffRequestId.current
    /*
     * Nothing to load for a turn: its diff comes from the checkpoint store. Running anyway meant
     * every refresh - each turn end, each working-tree broadcast, each window focus - shelled out to
     * `git diff` for a result the panel then discarded.
     */
    if (!workingPath || scopeKind === 'turn') {
      dispatch({ type: 'clear' })
      return
    }
    const scopedSelection: DiffScopeSelection =
      scopeKind === 'branch' ? { kind: 'branch', baseRef: branchBaseRef } : { kind: 'unstaged' }
    // Never null here: the turn scope returned above.
    const pending = fetchDiffsForScope(workingPath, scopedSelection)
    if (pending === null) return

    dispatch({ type: 'start-loading' })
    let cancelled = false
    pending
      .then((result) => {
        if (cancelled || requestId !== diffRequestId.current) return
        dispatch(
          result.ok ? loadSuccessAction(result) : { type: 'load-failure', error: result.message },
        )
      })
      .catch((error: unknown) => {
        /*
         * Only an unexpected transport failure reaches here; expected git failures arrive as
         * { ok: false } above. It still needs a message: a null error rendered as "No changes to
         * review", which tells the user their work is committed when the panel could not read
         * the tree at all.
         */
        if (cancelled || requestId !== diffRequestId.current) return
        // refreshToken identifies which refresh generation failed (matches useSessionTurns).
        logger.warn('Failed to load diffs', { error: String(error), refreshToken })
        dispatch({ type: 'load-failure', error: DIFF_TRANSPORT_FAILURE_MESSAGE })
      })
    return () => {
      cancelled = true
    }
  }, [workingPath, scopeKind, branchBaseRef, refreshToken])

  async function refreshDiff(workingPathToRefresh: WorkingPath) {
    // Nothing to refresh for a turn: its diff is owned by the checkpoint store, not this loader.
    const pending = fetchDiffsForScope(workingPathToRefresh, selectionRef.current)
    if (pending === null) return

    diffRequestId.current += 1
    const requestId = diffRequestId.current
    dispatch({ type: 'start-loading' })
    try {
      const result = await pending
      if (
        isStaleDiffRequest(
          requestId,
          diffRequestId.current,
          currentWorkingPath.current,
          workingPathToRefresh,
        )
      )
        return
      dispatch(
        result.ok ? loadSuccessAction(result) : { type: 'load-failure', error: result.message },
      )
    } catch {
      if (
        isStaleDiffRequest(
          requestId,
          diffRequestId.current,
          currentWorkingPath.current,
          workingPathToRefresh,
        )
      )
        return
      dispatch({ type: 'load-failure', error: DIFF_TRANSPORT_FAILURE_MESSAGE })
    }
  }

  return { ...state, refreshDiff }
}
