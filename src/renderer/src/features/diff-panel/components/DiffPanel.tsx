import type { CodeViewHandle } from '@pierre/diffs/react'
import type { RepositoryPath, SessionId, WorkingPath } from '@shared/types/brand'
import type { GitStackedAction } from '@shared/types/git'
import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import { useRef, useState } from 'react'
import { useDiffPanelGitActions } from '@/features/diff-panel/hooks/useDiffPanelGitActions'
import type { ReviewAnnotationMetadata } from '@/features/diff-panel/lib/code-view-items'
import { codeViewItemId } from '@/features/diff-panel/lib/code-view-items'
import {
  type DiffScopeSelection,
  selectThreadDiffScopeSelection,
  useDiffScopeStore,
} from '@/features/diff-panel/state/diff-scope-store'
import { useCombinedVcsStatus, useStackedGitActions } from '@/features/git'
import { useBaseRefChoices } from '../hooks/useBaseRefChoices'
import { useCommitPaths } from '../hooks/useCommitPaths'
import { useDiffPanelDiffs } from '../hooks/useDiffPanelDiffs'
import { useReconcileTurnSelection } from '../hooks/useReconcileTurnSelection'
import { useSessionTurns, useTurnDiffFiles } from '../hooks/useSessionTurns'
import { reviewKeyFor } from '../state/review-store'
import { CommitMessageDialog } from './CommitMessageDialog'
import { DiffBottomBar } from './DiffBottomBar'
import { DiffPanelHeader } from './DiffPanelHeader'
import { DiffReviewBody } from './DiffReviewBody'

interface DiffPanelProps {
  workingPath: WorkingPath | null
  repositoryPath: RepositoryPath | null
  sessionId?: SessionId | null
  onSendMessage: (content: string) => void
}

/** Switching to Turns means the latest captured turn, which the tabs do not know about. */
function selectScope(input: {
  readonly scope: 'branch' | 'unstaged' | 'turn'
  readonly scopeKey: string
  readonly turns: readonly TurnCheckpointSummary[]
  readonly selectTurn: (scopeKey: string, turnId: string) => void
  readonly selectGitScope: (scopeKey: string, scope: 'branch' | 'unstaged') => void
}) {
  if (input.scope === 'turn') {
    const latestTurn = input.turns.at(-1)
    if (latestTurn) input.selectTurn(input.scopeKey, latestTurn.turnId)
    return
  }
  input.selectGitScope(input.scopeKey, input.scope)
}

/** Open a change request in the user's browser, never in an Electron window. */
function openChangeRequestUrl(url: string | undefined) {
  if (url) window.open(url, '_blank', 'noopener')
}

export function DiffPanel({
  workingPath,
  repositoryPath,
  sessionId = null,
  onSendMessage,
}: DiffPanelProps) {
  const viewerRef = useRef<CodeViewHandle<ReviewAnnotationMetadata>>(null)
  const scopeByThreadKey = useDiffScopeStore((s) => s.byThreadKey)
  const selectGitScope = useDiffScopeStore((s) => s.selectGitScope)
  const selectBranchBaseRef = useDiffScopeStore((s) => s.selectBranchBaseRef)
  const selectTurn = useDiffScopeStore((s) => s.selectTurn)
  const scopeKey = sessionId ?? workingPath ?? ''
  const selection: DiffScopeSelection = selectThreadDiffScopeSelection(
    scopeByThreadKey,
    scopeKey || null,
    true,
  )
  const branchBaseRef = selection.kind === 'branch' ? selection.baseRef : null
  const baseRefChoices = useBaseRefChoices(repositoryPath)
  const turns = useSessionTurns(sessionId)
  const branchOrTreeDiffs = useDiffPanelDiffs(workingPath, selection)
  const turnFiles = useTurnDiffFiles(sessionId, selection)
  const fileDiffs = selection.kind === 'turn' ? turnFiles : branchOrTreeDiffs.fileDiffs
  const isLoading = selection.kind === 'turn' ? false : branchOrTreeDiffs.isLoading
  const refreshDiff = branchOrTreeDiffs.refreshDiff
  // Turn diffs come from the store, so only the branch/working-tree loader can fail here.
  const loadError = selection.kind === 'turn' ? null : branchOrTreeDiffs.error

  useReconcileTurnSelection(scopeKey, turns)

  const gitActions = useDiffPanelGitActions({
    workingPath,
    fallbackHasChanges: selection.kind === 'unstaged' && fileDiffs.length > 0,
    canMutateWorkingTree: selection.kind === 'unstaged',
    refreshDiff,
  })

  const { status: vcsStatus, refresh: refreshVcsStatus } = useCombinedVcsStatus(workingPath)
  const stackedActions = useStackedGitActions({
    workingPath,
    onCompleted: () => {
      if (workingPath) void refreshDiff(workingPath)
      void refreshVcsStatus()
    },
  })

  const [pendingCommitAction, setPendingCommitAction] = useState<GitStackedAction | null>(null)
  const commitPaths = useCommitPaths(workingPath)
  const retryLoad = () => {
    if (workingPath) void refreshDiff(workingPath)
  }

  /**
   * Commit-bearing actions must collect an explicit message first (review B2);
   * everything else dispatches immediately.
   */
  function requestStackedAction(action: GitStackedAction) {
    // Only ask for a message when there is something to commit: a dialog reading "0 changed files
    // will be committed" collects text that main would discard.
    if (action.startsWith('commit') && commitPaths.length > 0) {
      setPendingCommitAction(action)
      return
    }
    void stackedActions.run(action, { paths: commitPaths })
  }

  return (
    <div className="relative flex flex-col size-full bg-diff-bg">
      {workingPath ? (
        <DiffPanelHeader
          selection={selection}
          baseRefControl={{
            current: branchBaseRef,
            choices: baseRefChoices,
            resolvedAutomatic: branchOrTreeDiffs.resolvedBaseRef,
            fellBackToWorkingTree:
              selection.kind === 'branch' && branchOrTreeDiffs.automaticFellBackToWorkingTree,
            onChange: (baseRef) => selectBranchBaseRef(scopeKey, baseRef),
          }}
          turns={turns}
          onSelectScope={(scope) =>
            selectScope({ scope, scopeKey, turns, selectTurn, selectGitScope })
          }
          onSelectTurn={(turnId) => selectTurn(scopeKey, turnId)}
        />
      ) : null}
      <DiffReviewBody
        viewerRef={viewerRef}
        files={fileDiffs}
        isLoading={isLoading}
        loadError={loadError}
        onRetryLoad={retryLoad}
        onSendMessage={onSendMessage}
        onFileClick={(path) =>
          viewerRef.current?.scrollTo({ type: 'item', id: codeViewItemId(path), align: 'start' })
        }
        reviewKey={reviewKeyFor(scopeKey || null, selection.kind)}
      />
      <DiffBottomBar
        onRevertAll={gitActions.handleRevertAll}
        onStageAll={gitActions.handleStageAll}
        canRevertAll={gitActions.canRevertAll}
        canStageAll={gitActions.canStageAll}
        isActionRunning={gitActions.isActionRunning}
        quickAction={{
          status: vcsStatus,
          isBusy: stackedActions.isRunning,
          onRunAction: (action) => requestStackedAction(action),
          onPull: () => stackedActions.run('pull'),
          onOpenChangeRequest: () => openChangeRequestUrl(vcsStatus?.changeRequest?.url),
          onPublish: () => stackedActions.run('push'),
        }}
      />
      <CommitMessageDialog
        open={pendingCommitAction !== null}
        fileCount={commitPaths.length}
        onCancel={() => setPendingCommitAction(null)}
        onConfirm={(commitMessage) => {
          const action = pendingCommitAction
          setPendingCommitAction(null)
          if (action) void stackedActions.run(action, { paths: commitPaths, commitMessage })
        }}
      />
    </div>
  )
}
