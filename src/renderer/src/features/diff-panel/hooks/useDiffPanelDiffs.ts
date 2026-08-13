import { matchBy } from '@diegogbrisa/ts-match'
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
  currentProjectPath: string | null,
  requestedProjectPath: string,
) {
  return requestId !== latestRequestId || currentProjectPath !== requestedProjectPath
}

function fetchDiffsForScope(projectPath: string, selection: DiffScopeSelection) {
  if (selection.kind === 'branch') {
    return api.getGitBranchDiff(projectPath, selection.baseRef ?? '')
  }
  return api.getGitDiff(projectPath)
}

/** Load and refresh diffs for the active scope (working tree or branch-vs-base). */
export function useDiffPanelDiffs(projectPath: string | null, selection: DiffScopeSelection) {
  const [state, dispatch] = useReducer(diffPanelReducer, {
    fileDiffs: [],
    isLoading: false,
    error: null,
  })
  const currentProjectPath = useRef(projectPath)
  const diffRequestId = useRef(0)
  const selectionRef = useRef(selection)
  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  useEffect(() => {
    currentProjectPath.current = projectPath
  }, [projectPath])

  const scopeKind = selection.kind
  const branchBaseRef = selection.kind === 'branch' ? (selection.baseRef ?? '') : ''

  useEffect(() => {
    diffRequestId.current += 1
    const requestId = diffRequestId.current
    if (!projectPath) {
      dispatch({ type: 'clear' })
      return
    }
    const scopedSelection: DiffScopeSelection =
      scopeKind === 'branch' ? { kind: 'branch', baseRef: branchBaseRef } : { kind: 'unstaged' }
    dispatch({ type: 'start-loading' })
    let cancelled = false
    fetchDiffsForScope(projectPath, scopedSelection)
      .then((result) => {
        if (cancelled || requestId !== diffRequestId.current) return
        dispatch(
          result.ok
            ? { type: 'load-success', fileDiffs: result.files }
            : { type: 'load-failure', error: result.message },
        )
      })
      .catch(() => {
        // Only an unexpected transport failure reaches here now; expected git
        // failures arrive as { ok: false } above.
        if (cancelled || requestId !== diffRequestId.current) return
        dispatch({ type: 'load-failure', error: null })
      })
    return () => {
      cancelled = true
    }
  }, [projectPath, scopeKind, branchBaseRef])

  async function refreshDiff(projectPathToRefresh: string) {
    diffRequestId.current += 1
    const requestId = diffRequestId.current
    dispatch({ type: 'start-loading' })
    try {
      const result = await fetchDiffsForScope(projectPathToRefresh, selectionRef.current)
      if (
        isStaleDiffRequest(
          requestId,
          diffRequestId.current,
          currentProjectPath.current,
          projectPathToRefresh,
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
          currentProjectPath.current,
          projectPathToRefresh,
        )
      )
        return
      dispatch({ type: 'load-failure', error: null })
    }
  }

  return { ...state, refreshDiff }
}
