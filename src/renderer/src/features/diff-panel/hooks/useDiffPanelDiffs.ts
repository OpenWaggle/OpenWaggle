import { matchBy } from '@diegogbrisa/ts-match'
import type { GitFileDiff } from '@shared/types/git'
import { useEffect, useReducer, useRef } from 'react'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { api } from '@/shared/lib/ipc'

interface DiffPanelState {
  readonly fileDiffs: readonly GitFileDiff[]
  readonly isLoading: boolean
}

type DiffPanelAction =
  | { readonly type: 'clear' }
  | { readonly type: 'start-loading' }
  | { readonly type: 'load-success'; readonly fileDiffs: readonly GitFileDiff[] }
  | { readonly type: 'load-failure' }

function diffPanelReducer(state: DiffPanelState, action: DiffPanelAction) {
  return matchBy(action, 'type')
    .with('clear', () => ({ fileDiffs: [], isLoading: false }))
    .with('start-loading', () => ({ ...state, isLoading: true }))
    .with('load-success', (value) => ({ ...state, fileDiffs: value.fileDiffs, isLoading: false }))
    .with('load-failure', () => ({ ...state, fileDiffs: [], isLoading: false }))
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
  const [state, dispatch] = useReducer(diffPanelReducer, { fileDiffs: [], isLoading: false })
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
      .then((diffs) => {
        if (cancelled || requestId !== diffRequestId.current) return
        dispatch({ type: 'load-success', fileDiffs: diffs })
      })
      .catch(() => {
        if (cancelled || requestId !== diffRequestId.current) return
        dispatch({ type: 'load-failure' })
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
      const diffs = await fetchDiffsForScope(projectPathToRefresh, selectionRef.current)
      if (
        isStaleDiffRequest(
          requestId,
          diffRequestId.current,
          currentProjectPath.current,
          projectPathToRefresh,
        )
      )
        return
      dispatch({ type: 'load-success', fileDiffs: diffs })
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
      dispatch({ type: 'load-failure' })
    }
  }

  return { ...state, refreshDiff }
}
