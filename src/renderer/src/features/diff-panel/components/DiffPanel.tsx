import type { SessionId } from '@shared/types/brand'
import type { GitStackedAction } from '@shared/types/git'
import type { ReviewComment } from '@shared/types/review'
import { useState } from 'react'
import { useDiffPanelGitActions } from '@/features/diff-panel/hooks/useDiffPanelGitActions'
import {
  type DiffScopeSelection,
  selectThreadDiffScopeSelection,
  useDiffScopeStore,
} from '@/features/diff-panel/state/diff-scope-store'
import type { ReviewCommentLocation } from '@/features/diff-panel/state/review-store'
import { useReviewStore } from '@/features/diff-panel/state/review-store'
import { useCombinedVcsStatus, useStackedGitActions } from '@/features/git'
import { Spinner } from '@/shared/ui/Spinner'
import { useBaseRefChoices } from '../hooks/useBaseRefChoices'
import { type RenderableDiffFile, useDiffPanelDiffs } from '../hooks/useDiffPanelDiffs'
import { useDiffReviewActions } from '../hooks/useDiffReviewActions'
import { useReconcileTurnSelection } from '../hooks/useReconcileTurnSelection'
import { useSessionTurns, useTurnDiffFiles } from '../hooks/useSessionTurns'
import { CommitMessageDialog } from './CommitMessageDialog'
import { DiffBottomBar } from './DiffBottomBar'
import { DiffFileSection } from './DiffFileSection'
import { DiffScopeTabs } from './DiffScopeTabs'
import { FileTree } from './FileTree'

interface DiffPanelProps {
  projectPath: string | null
  sessionId?: SessionId | null
  onSendMessage: (content: string) => void
}

interface DiffPanelContentProps {
  readonly fileDiffs: readonly RenderableDiffFile[]
  readonly isLoading: boolean
  readonly review: {
    readonly comments: readonly ReviewComment[]
    readonly activeCommentLocation: ReviewCommentLocation | null
  }
  readonly actions: {
    readonly onSetActiveComment: (location: ReviewCommentLocation | null) => void
    readonly onAddSingleComment: (
      filePath: string,
      startLine: number,
      endLine: number,
      content: string,
    ) => void
    readonly onAddToReview: (comment: ReviewComment) => void
    readonly onSendReview: () => void
    readonly onFileClick: (path: string) => void
  }
}

function DiffPanelContent({ fileDiffs, isLoading, review, actions }: DiffPanelContentProps) {
  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="diff-scroll flex-1 overflow-auto p-2.5">
        <div className="flex min-w-full w-max flex-col gap-2.5">
          {isLoading && (
            <div className="flex items-center justify-center h-20 text-text-tertiary">
              <Spinner />
            </div>
          )}
          {!isLoading && fileDiffs.length === 0 && (
            <div className="flex items-center justify-center h-20 text-[12px] text-text-tertiary">
              No uncommitted changes
            </div>
          )}
          {fileDiffs.map((file) => (
            <div key={file.path} id={`diff-file-${file.path}`}>
              <DiffFileSection
                filePath={file.path}
                items={file.items}
                additions={file.additions}
                deletions={file.deletions}
                activeCommentLocation={review.activeCommentLocation}
                onSetActiveComment={actions.onSetActiveComment}
                onAddSingleComment={actions.onAddSingleComment}
                onAddToReview={actions.onAddToReview}
              />
            </div>
          ))}
        </div>
      </div>

      <FileTree
        files={fileDiffs}
        onFileClick={actions.onFileClick}
        onSendReview={actions.onSendReview}
        reviewCount={review.comments.length}
      />
    </div>
  )
}

export function DiffPanel({ projectPath, sessionId = null, onSendMessage }: DiffPanelProps) {
  const comments = useReviewStore((s) => s.comments)
  const activeCommentLocation = useReviewStore((s) => s.activeCommentLocation)
  const setActiveCommentLocation = useReviewStore((s) => s.setActiveCommentLocation)
  const reviewActions = useDiffReviewActions(onSendMessage)
  const scopeByThreadKey = useDiffScopeStore((s) => s.byThreadKey)
  const selectGitScope = useDiffScopeStore((s) => s.selectGitScope)
  const selectBranchBaseRef = useDiffScopeStore((s) => s.selectBranchBaseRef)
  const selectTurn = useDiffScopeStore((s) => s.selectTurn)
  const scopeKey = sessionId ?? projectPath ?? ''
  const selection: DiffScopeSelection = selectThreadDiffScopeSelection(
    scopeByThreadKey,
    scopeKey || null,
    true,
  )
  const branchBaseRef = selection.kind === 'branch' ? selection.baseRef : null
  const baseRefChoices = useBaseRefChoices(projectPath)
  const turns = useSessionTurns(sessionId)
  const branchOrTreeDiffs = useDiffPanelDiffs(projectPath, selection)
  const turnFiles = useTurnDiffFiles(sessionId, selection)
  const fileDiffs = selection.kind === 'turn' ? turnFiles : branchOrTreeDiffs.fileDiffs
  const isLoading = selection.kind === 'turn' ? false : branchOrTreeDiffs.isLoading
  const refreshDiff = branchOrTreeDiffs.refreshDiff

  useReconcileTurnSelection(scopeKey, turns)

  function handleSelectScope(scope: 'branch' | 'unstaged' | 'turn') {
    if (scope === 'turn') {
      const latestTurn = turns.at(-1)
      if (latestTurn) selectTurn(scopeKey, latestTurn.turnId)
      return
    }
    selectGitScope(scopeKey, scope)
  }

  const gitActions = useDiffPanelGitActions({
    projectPath,
    fallbackHasChanges: selection.kind === 'unstaged' && fileDiffs.length > 0,
    canMutateWorkingTree: selection.kind === 'unstaged',
    refreshDiff,
  })

  const { status: vcsStatus, refresh: refreshVcsStatus } = useCombinedVcsStatus(projectPath)
  const stackedActions = useStackedGitActions({
    projectPath,
    onCompleted: () => {
      if (projectPath) void refreshDiff(projectPath)
      void refreshVcsStatus()
    },
  })

  const [pendingCommitAction, setPendingCommitAction] = useState<GitStackedAction | null>(null)
  const selectedPaths = fileDiffs.map((file) => file.path)

  /**
   * Commit-bearing actions must collect an explicit message first (review B2);
   * everything else dispatches immediately. Only the visible selection is staged.
   */
  function requestStackedAction(action: GitStackedAction) {
    if (action.startsWith('commit')) {
      setPendingCommitAction(action)
      return
    }
    void stackedActions.run(action, { paths: selectedPaths })
  }

  function handleFileClick(path: string) {
    const el = document.getElementById(`diff-file-${path}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="relative flex flex-col size-full bg-diff-bg">
      {projectPath ? (
        <DiffScopeTabs
          selection={selection}
          baseRef={branchBaseRef}
          baseRefChoices={baseRefChoices}
          turns={turns}
          onSelectScope={handleSelectScope}
          onChangeBaseRef={(baseRef) => selectBranchBaseRef(scopeKey, baseRef)}
          onSelectTurn={(turnId) => selectTurn(scopeKey, turnId)}
        />
      ) : null}
      <DiffPanelContent
        fileDiffs={fileDiffs}
        isLoading={isLoading}
        review={{ comments, activeCommentLocation }}
        actions={{
          onSetActiveComment: setActiveCommentLocation,
          onAddSingleComment: reviewActions.onAddSingleComment,
          onAddToReview: reviewActions.onAddToReview,
          onSendReview: reviewActions.onSendReview,
          onFileClick: handleFileClick,
        }}
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
          onOpenChangeRequest: () => {
            const url = vcsStatus?.changeRequest?.url
            if (url) window.open(url, '_blank', 'noopener')
          },
          onPublish: () => stackedActions.run('push'),
        }}
      />
      <CommitMessageDialog
        open={pendingCommitAction !== null}
        fileCount={selectedPaths.length}
        onCancel={() => setPendingCommitAction(null)}
        onConfirm={(commitMessage) => {
          const action = pendingCommitAction
          setPendingCommitAction(null)
          if (action) void stackedActions.run(action, { paths: selectedPaths, commitMessage })
        }}
      />
    </div>
  )
}
