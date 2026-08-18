import { matchBy } from '@diegogbrisa/ts-match'
import type { WorkingPath } from '@shared/types/brand'
import type { GitFileDiff } from '@shared/types/git'
import { useEffect, useReducer, useRef } from 'react'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { api } from '@/shared/lib/ipc'

interface DiffPanelState {
  readonly fileDiffs: readonly GitFileDiff[]
  readonly isLoading: boolean
  /** Message from a typed load failure; null when the last load succeeded. */
  readonly error: string | null
}

const DIFF_TRANSPORT_FAILURE_MESSAGE = 'The diff could not be loaded from the main process.'

type DiffPanelAction =
  | { readonly type: 'clear' }
  | { readonly type: 'start-loading' }
  | { readonly type: 'load-success'; readonly fileDiffs: readonly GitFileDiff[] }
  | { readonly type: 'load-failure'; readonly error: string | null }

function diffPanelReducer(state: DiffPanelState, action: DiffPanelAction) {
  return matchBy(action, 'type')
    .with('clear', () => ({ fileDiffs: [], isLoading: false, error: null }))
    .with('start-loading', () => ({ ...state, isLoading: true }))
    .with('load-success', (value) => ({
      ...state,
      fileDiffs: value.fileDiffs,
      isLoading: false,
      error: null,
    }))
    .with('load-failure', (value) => ({
      ...state,
      fileDiffs: [],
      isLoading: false,
      error: value.error,
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

function fetchDiffsForScope(workingPath: WorkingPath, selection: DiffScopeSelection) {
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
export function useDiffPanelDiffs(workingPath: WorkingPath | null, selection: DiffScopeSelection) {
  const [state, dispatch] = useReducer(diffPanelReducer, {
    fileDiffs: [],
    isLoading: false,
    error: null,
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
    if (!workingPath) {
      dispatch({ type: 'clear' })
      return
    }
    const scopedSelection: DiffScopeSelection =
      scopeKind === 'branch' ? { kind: 'branch', baseRef: branchBaseRef } : { kind: 'unstaged' }
    dispatch({ type: 'start-loading' })
    let cancelled = false
    fetchDiffsForScope(workingPath, scopedSelection)
      .then((result) => {
        if (cancelled || requestId !== diffRequestId.current) return
        dispatch(
          result.ok
            ? { type: 'load-success', fileDiffs: result.files }
            : { type: 'load-failure', error: result.message },
        )
      })
      .catch(() => {
        /*
         * Only an unexpected transport failure reaches here; expected git failures arrive as
         * { ok: false } above. It still needs a message: a null error rendered as "No changes to
         * review", which tells the user their work is committed when the panel could not read
         * the tree at all.
         */
        if (cancelled || requestId !== diffRequestId.current) return
        dispatch({ type: 'load-failure', error: DIFF_TRANSPORT_FAILURE_MESSAGE })
      })
    return () => {
      cancelled = true
    }
  }, [workingPath, scopeKind, branchBaseRef])

  async function refreshDiff(workingPathToRefresh: WorkingPath) {
    diffRequestId.current += 1
    const requestId = diffRequestId.current
    dispatch({ type: 'start-loading' })
    try {
      const result = await fetchDiffsForScope(workingPathToRefresh, selectionRef.current)
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
        result.ok
          ? { type: 'load-success', fileDiffs: result.files }
          : { type: 'load-failure', error: result.message },
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
