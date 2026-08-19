import type { CodeViewHandle } from '@pierre/diffs/react'
import type { GitFileDiff } from '@shared/types/git'
import type { Ref } from 'react'
import type { ReviewAnnotationMetadata } from '@/features/diff-panel/lib/code-view-items'
import { useUIStore } from '@/shell/ui-store'
import { useDiffReviewActions } from '../hooks/useDiffReviewActions'
import { useDiffViewOptions } from '../hooks/useDiffViewOptions'
import { DiffCodeView } from './DiffCodeView'
import { FileTree } from './FileTree'
import { ReviewBar } from './ReviewBar'

interface DiffReviewBodyProps {
  readonly viewerRef: Ref<CodeViewHandle<ReviewAnnotationMetadata>>
  readonly files: readonly GitFileDiff[]
  readonly isLoading: boolean
  /** A failed diff load, surfaced instead of an empty diff. */
  readonly loadError: string | null
  readonly onRetryLoad: () => void
  readonly onSendMessage: (content: string) => void | Promise<void>
  readonly onFileClick: (path: string) => void
  /** Isolates pending comments to the tree and scope they were written against. */
  readonly reviewKey: string
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
  loadError,
  onRetryLoad,
  onSendMessage,
  onFileClick,
  reviewKey,
}: DiffReviewBodyProps) {
  const { viewOptions } = useDiffViewOptions()
  const showToast = useUIStore((state) => state.showToast)
  const review = useDiffReviewActions(onSendMessage, files, reviewKey, (error) => {
    // A restored review that lands out of view is no better than a lost one if nothing says why.
    showToast(`Could not send this review: ${String(error)}`, 'error')
  })

  return (
    <>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <DiffCodeView
          viewerRef={viewerRef}
          files={files}
          isLoading={isLoading}
          loadError={loadError}
          onRetryLoad={onRetryLoad}
          viewOptions={viewOptions}
          review={{
            comments: review.comments,
            activeCommentLocation: review.activeCommentLocation,
            onSetActiveComment: review.onSetActiveComment,
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
