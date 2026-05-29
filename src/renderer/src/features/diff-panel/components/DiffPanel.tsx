import { matchBy } from '@diegogbrisa/ts-match'
import type { GitFileDiff } from '@shared/types/git'
import type { ReviewComment } from '@shared/types/review'
import { useEffect, useReducer } from 'react'
import type { ReviewCommentLocation } from '@/features/diff-panel/state/review-store'
import { useReviewStore } from '@/features/diff-panel/state/review-store'
import { api } from '@/shared/lib/ipc'
import { Spinner } from '@/shared/ui/Spinner'
import { DiffBottomBar } from './DiffBottomBar'
import { DiffFileSection } from './DiffFileSection'
import { buildDisplayItems, type DisplayItem } from './diff-display-items'
import { FileTree } from './FileTree'

interface DiffPanelProps {
  projectPath: string | null
  onSendMessage: (content: string) => void
}

interface RenderableDiffFile extends GitFileDiff {
  readonly items: DisplayItem[]
}

interface DiffPanelState {
  readonly fileDiffs: readonly RenderableDiffFile[]
  readonly isLoading: boolean
}

type DiffPanelAction =
  | { readonly type: 'clear' }
  | { readonly type: 'start-loading' }
  | { readonly type: 'load-success'; readonly fileDiffs: readonly RenderableDiffFile[] }
  | { readonly type: 'load-failure' }

function diffPanelReducer(state: DiffPanelState, action: DiffPanelAction) {
  return matchBy(action, 'type')
    .with('clear', () => ({ fileDiffs: [], isLoading: false }))
    .with('start-loading', () => ({ ...state, isLoading: true }))
    .with('load-success', (value) => ({ fileDiffs: value.fileDiffs, isLoading: false }))
    .with('load-failure', () => ({ fileDiffs: [], isLoading: false }))
    .exhaustive()
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
  const [state, dispatch] = useReducer(diffPanelReducer, {
    fileDiffs: [],
    isLoading: false,
  })

  const comments = useReviewStore((s) => s.comments)
  const activeCommentLocation = useReviewStore((s) => s.activeCommentLocation)
  const setActiveCommentLocation = useReviewStore((s) => s.setActiveCommentLocation)
  const addComment = useReviewStore((s) => s.addComment)
  const clearComments = useReviewStore((s) => s.clearComments)

  useEffect(() => {
    if (!projectPath) {
      dispatch({ type: 'clear' })
      return
    }

    dispatch({ type: 'start-loading' })
    let cancelled = false
    api
      .getGitDiff(projectPath)
      .then((diffs) => {
        if (cancelled) return
        dispatch({
          type: 'load-success',
          fileDiffs: diffs.map((diff) => ({
            ...diff,
            items: buildDisplayItems(diff.diff),
          })),
        })
      })
      .catch(() => {
        if (cancelled) return
        dispatch({ type: 'load-failure' })
      })

    return () => {
      cancelled = true
    }
  }, [projectPath])

  const { fileDiffs, isLoading } = state

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

  function handleRevertAll() {
    // Future: implement git checkout -- . via IPC
  }

  function handleStageAll() {
    // Future: implement git add -A via IPC
  }

  return (
    <div className="flex flex-col size-full bg-diff-bg">
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
        onRevertAll={handleRevertAll}
        onStageAll={handleStageAll}
        hasChanges={fileDiffs.length > 0}
      />
    </div>
  )
}
