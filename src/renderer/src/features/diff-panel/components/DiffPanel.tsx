import type { ReviewComment } from '@shared/types/review'
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
import { DiffBottomBar } from './DiffBottomBar'
import { DiffFileSection } from './DiffFileSection'
import { DiffScopeTabs } from './DiffScopeTabs'
import { FileTree } from './FileTree'

interface DiffPanelProps {
  projectPath: string | null
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

export function DiffPanel({ projectPath, onSendMessage }: DiffPanelProps) {
  const comments = useReviewStore((s) => s.comments)
  const activeCommentLocation = useReviewStore((s) => s.activeCommentLocation)
  const setActiveCommentLocation = useReviewStore((s) => s.setActiveCommentLocation)
  const addComment = useReviewStore((s) => s.addComment)
  const clearComments = useReviewStore((s) => s.clearComments)
  const scopeByThreadKey = useDiffScopeStore((s) => s.byThreadKey)
  const selectGitScope = useDiffScopeStore((s) => s.selectGitScope)
  const selectBranchBaseRef = useDiffScopeStore((s) => s.selectBranchBaseRef)
  const scopeKey = projectPath ?? ''
  const selection: DiffScopeSelection = selectThreadDiffScopeSelection(
    scopeByThreadKey,
    scopeKey || null,
    true,
  )
  const branchBaseRef = selection.kind === 'branch' ? selection.baseRef : null
  const baseRefChoices = useBaseRefChoices(projectPath)
  const { fileDiffs, isLoading, refreshDiff } = useDiffPanelDiffs(projectPath, selection)

  const gitActions = useDiffPanelGitActions({
    projectPath,
    fallbackHasChanges: fileDiffs.length > 0,
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

  function handleAddSingleComment(
    filePath: string,
    startLine: number,
    endLine: number,
    content: string,
  ) {
    const lineRef =
      startLine !== endLine ? `s ${String(startLine)}-${String(endLine)}` : ` ${String(startLine)}`
    const message = `**Review comment** on \`${filePath}\` (line${lineRef}):\n\n${content}`
    onSendMessage(message)
    setActiveCommentLocation(null)
  }

  function handleAddToReview(comment: ReviewComment) {
    addComment(comment)
  }

  function handleSendReview() {
    if (comments.length === 0) return
    const lines = comments.map((c) => {
      const lineRef =
        c.startLine !== c.endLine
          ? `s ${String(c.startLine)}-${String(c.endLine)}`
          : ` ${String(c.startLine)}`
      return `- **\`${c.filePath}\`** line${lineRef}: ${c.content}`
    })
    const message = `**Code Review**\n\n${lines.join('\n')}`
    onSendMessage(message)
    clearComments()
  }

  function handleFileClick(path: string) {
    const el = document.getElementById(`diff-file-${path}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex flex-col size-full bg-diff-bg">
      {projectPath ? (
        <DiffScopeTabs
          selection={selection}
          baseRef={branchBaseRef}
          baseRefChoices={baseRefChoices}
          onSelectScope={(scope) => selectGitScope(scopeKey, scope)}
          onChangeBaseRef={(baseRef) => selectBranchBaseRef(scopeKey, baseRef)}
        />
      ) : null}
      <DiffPanelContent
        fileDiffs={fileDiffs}
        isLoading={isLoading}
        review={{ comments, activeCommentLocation }}
        actions={{
          onSetActiveComment: setActiveCommentLocation,
          onAddSingleComment: handleAddSingleComment,
          onAddToReview: handleAddToReview,
          onSendReview: handleSendReview,
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
          onRunAction: (action) => stackedActions.run(action),
          onPull: () => stackedActions.run('pull'),
          onOpenChangeRequest: () => {
            if (vcsStatus?.pr?.url) window.open(vcsStatus.pr.url, '_blank', 'noopener')
          },
          onPublish: () => stackedActions.run('push'),
        }}
      />
    </div>
  )
}
