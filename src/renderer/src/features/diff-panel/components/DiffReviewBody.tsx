import type { CodeViewHandle } from '@pierre/diffs/react'
import type { GitFileDiff } from '@shared/types/git'
import type { Ref } from 'react'
import type { ReviewAnnotationMetadata } from '@/features/diff-panel/lib/code-view-items'
import { useReviewStore } from '@/features/diff-panel/state/review-store'
import { useDiffReviewActions } from '../hooks/useDiffReviewActions'
import { useDiffViewOptions } from '../hooks/useDiffViewOptions'
import { DiffCodeView } from './DiffCodeView'
import { FileTree } from './FileTree'
import { ReviewBar } from './ReviewBar'

interface DiffReviewBodyProps {
  readonly viewerRef: Ref<CodeViewHandle<ReviewAnnotationMetadata>>
  readonly files: readonly GitFileDiff[]
  readonly isLoading: boolean
  readonly onSendMessage: (content: string) => void
  readonly onFileClick: (path: string) => void
}

/**
 * The diff surface, its Changed-file navigator, and the Review bar.
 *
 * Owns the review concern rather than receiving it: the state is store-backed, so
 * subscribing here keeps DiffPanel free of review wiring and avoids drilling a
 * callback per action through it.
 */
export function DiffReviewBody({
  viewerRef,
  files,
  isLoading,
  onSendMessage,
  onFileClick,
}: DiffReviewBodyProps) {
  const activeCommentLocation = useReviewStore((s) => s.activeCommentLocation)
  const setActiveCommentLocation = useReviewStore((s) => s.setActiveCommentLocation)
  const { viewOptions } = useDiffViewOptions()
  const review = useDiffReviewActions(onSendMessage, files)

  return (
    <>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <DiffCodeView
          viewerRef={viewerRef}
          files={files}
          isLoading={isLoading}
          viewOptions={viewOptions}
          review={{
            comments: review.comments,
            activeCommentLocation,
            onSetActiveComment: setActiveCommentLocation,
            onAddSingleComment: review.onAddSingleComment,
            onAddToReview: review.onAddToReview,
            onRemoveComment: review.onRemoveComment,
          }}
        />
        <FileTree files={files} onFileClick={onFileClick} />
      </div>
      <ReviewBar
        commentCount={review.comments.length}
        summary={review.summary}
        onSummaryChange={review.onSetSummary}
        onSubmit={review.onSubmitReview}
        onDiscard={review.onDiscardReview}
      />
    </>
  )
}
