import type { CodeViewHandle } from '@pierre/diffs/react'
import type { RepositoryPath, SessionId, WorkingPath } from '@shared/types/brand'
import type { GitStackedAction } from '@shared/types/git'
import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import { useRef, useState } from 'react'
import { useDiffPanelGitActions } from '@/features/diff-panel/hooks/useDiffPanelGitActions'
import type { ReviewAnnotationMetadata } from '@/features/diff-panel/lib/code-view-items'
import { codeViewItemId } from '@/features/diff-panel/lib/code-view-items'
import {
  selectThreadDiffScopeSelection,
  useDiffScopeStore,
} from '@/features/diff-panel/state/diff-scope-store'
import { useCombinedVcsStatus, useStackedGitActions } from '@/features/git'
import { useUIStore } from '@/shell/ui-store'
import { useBaseRefChoices } from '../hooks/useBaseRefChoices'
import { useCommitPaths } from '../hooks/useCommitPaths'
import { useDisplayedDiff } from '../hooks/useDisplayedDiff'
import { useReconcileTurnSelection } from '../hooks/useReconcileTurnSelection'
import { useSessionTurns } from '../hooks/useSessionTurns'
import { reviewKeyFor } from '../state/review-store'
import { CommitMessageDialog } from './CommitMessageDialog'
import { DiffBottomBar } from './DiffBottomBar'
import { DiffPanelHeader } from './DiffPanelHeader'
import { DiffReviewBody } from './DiffReviewBody'

interface DiffPanelProps {
  workingPath: WorkingPath | null
  repositoryPath: RepositoryPath | null
  sessionId?: SessionId | null
  onSendMessage: (content: string) => void | Promise<void>
  /**
   * Bumped when the diff should be reloaded.
   *
   * Refresh used to remount this panel via `key=`, which discarded every piece of panel-local
   * state: the scroll position in a long diff, the navigator's collapsed folders, the line
   * selection, and a commit message the user was part-way through typing. Refreshes fire on every
   * turn end, every working-tree broadcast and every window focus, so that was routine.
   */
  refreshToken?: number
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

const NOTHING_TO_COMMIT_MESSAGE = 'No changes in this working tree to commit.'

/**
 * Dispatch a quick action, collecting a commit message first when one is needed.
 *
 * Nothing to commit is reported rather than dispatched: an empty set produced a `nothing-to-commit`
 * failure whose message blamed the user for not selecting files, with no dialog shown - an enabled
 * button that silently did nothing.
 */
function requestStackedAction(input: {
  readonly action: GitStackedAction
  readonly commitPaths: readonly string[]
  readonly run: (action: GitStackedAction, options?: { paths: readonly string[] }) => void
  readonly showToast: (message: string, variant: 'error') => void
  readonly onNeedsMessage: (action: GitStackedAction) => void
}) {
  if (!input.action.startsWith('commit')) {
    input.run(input.action, { paths: input.commitPaths })
    return
  }
  if (input.commitPaths.length === 0) input.showToast(NOTHING_TO_COMMIT_MESSAGE, 'error')
  else input.onNeedsMessage(input.action)
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
  refreshToken = 0,
}: DiffPanelProps) {
  const viewerRef = useRef<CodeViewHandle<ReviewAnnotationMetadata>>(null)
  const scopeByThreadKey = useDiffScopeStore((s) => s.byThreadKey)
  const selectGitScope = useDiffScopeStore((s) => s.selectGitScope)
  const selectBranchBaseRef = useDiffScopeStore((s) => s.selectBranchBaseRef)
  const selectTurn = useDiffScopeStore((s) => s.selectTurn)
  const scopeKey = sessionId ?? workingPath ?? ''
  const commitPaths = useCommitPaths(workingPath, refreshToken)
  const showToast = useUIStore((state) => state.showToast)
  const selection = selectThreadDiffScopeSelection(scopeByThreadKey, scopeKey || null)
  const branchBaseRef = selection.kind === 'branch' ? selection.baseRef : null
  const baseRefChoices = useBaseRefChoices(repositoryPath)
  const turns = useSessionTurns(sessionId, refreshToken)
  const displayed = useDisplayedDiff({ sessionId, workingPath, selection, refreshToken })
  const { fileDiffs, isLoading, loadError, refreshDiff } = displayed

  useReconcileTurnSelection(scopeKey, turns)

  const gitActions = useDiffPanelGitActions({
    workingPath,
    fallbackHasChanges: selection.kind === 'unstaged' && fileDiffs.length > 0,
    canMutateWorkingTree: selection.kind === 'unstaged',
    refreshDiff,
  })

  const { status: vcsStatus, refresh: refreshVcsStatus } = useCombinedVcsStatus(
    workingPath,
    refreshToken,
  )
  const stackedActions = useStackedGitActions({
    workingPath,
    onCompleted: () => {
      if (workingPath) void refreshDiff(workingPath)
      void refreshVcsStatus()
    },
  })

  const [pendingCommitAction, setPendingCommitAction] = useState<GitStackedAction | null>(null)
  const retryLoad = () => {
    if (workingPath) void refreshDiff(workingPath)
  }

  /**
   * Commit-bearing actions must collect an explicit message first (review B2);
   * everything else dispatches immediately.
   */
  return (
    <div className="relative flex flex-col size-full bg-diff-bg">
      {workingPath ? (
        <DiffPanelHeader
          selection={selection}
          baseRefControl={{
            current: branchBaseRef,
            choices: baseRefChoices,
            resolvedAutomatic: displayed.resolvedAutomaticBaseRef,
            fellBackToWorkingTree: displayed.automaticFellBackToWorkingTree,
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
        reviewKey={reviewKeyFor(scopeKey || null, selection)}
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
          onRunAction: (action) =>
            requestStackedAction({
              action,
              commitPaths,
              run: stackedActions.run,
              showToast,
              onNeedsMessage: setPendingCommitAction,
            }),
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
