import type { GitFileDiff } from '@shared/types/git'
import { useDeferredValue } from 'react'
import { isReportableSendFailure } from '@/features/chat/lib'
import { WorkspaceTreePanel } from '@/shared/ui/WorkspaceTreePanel'
import { useUIStore } from '@/shell/ui-store'
import { useDiffReviewActions } from '../hooks/useDiffReviewActions'
import { useDiffViewOptions } from '../hooks/useDiffViewOptions'
import type { DiffFileNavigation } from '../hooks/usePreparedDiffFileNavigation'
import { DiffCodeView } from './DiffCodeView'
import { FileTree } from './FileTree'
import { ReviewBar } from './ReviewBar'

interface DiffReviewBodyProps {
  readonly files: readonly GitFileDiff[]
  readonly isLoading: boolean
  /** A failed diff load, surfaced instead of an empty diff. */
  readonly loadError: string | null
  readonly onRetryLoad: () => void
  readonly onSendMessage: (content: string) => void | Promise<void>
  readonly onFileClick: (path: string) => void
  readonly fileNavigation?: DiffFileNavigation | null
  /** Isolates pending comments to the tree and scope they were written against. */
  /** The key this panel's review lives under, with the draft key it would use before a session exists. */
  /**
   * This panel's review key, with a way to build the key for a session that does not exist yet: a review
   * submitted before any session exists has to follow the session created to carry it.
   */
  readonly reviewKeys: {
    readonly reviewKey: string
    readonly keyForSession: (sessionId: string) => string
  }
}

const EMPTY_DIFF_FILES: readonly GitFileDiff[] = []

/**
 * The diff surface, its Changed-file navigator, and the Review bar.
 *
 * Owns the review concern rather than receiving it: the state is store-backed, so
 * subscribing here keeps DiffPanel free of review wiring and avoids drilling a
 * callback per action through it.
 */
export function DiffReviewBody({
  files,
  isLoading,
  loadError,
  onRetryLoad,
  onSendMessage,
  onFileClick,
  fileNavigation = null,
  reviewKeys,
}: DiffReviewBodyProps) {
  const { viewOptions } = useDiffViewOptions()
  const showToast = useUIStore((state) => state.showToast)
  const workspaceTreeOpen = useUIStore((state) => state.workspaceTreeOpen)
  // A large expanded navigator can contain hundreds of rows. Let the loading/highlight surface
  // commit first, then fill the secondary navigator without extending time-to-feedback.
  const deferredTreeFiles = useDeferredValue(files, EMPTY_DIFF_FILES)
  const review = useDiffReviewActions(
    onSendMessage,
    files,
    reviewKeys.reviewKey,
    reviewKeys.keyForSession,
    (error) => {
      /*
       * A restored review that lands out of view is no better than a lost one if nothing says why - but a
       * cancellation is the user's own Stop, and reporting that as a failure would be noise about something
       * they asked for. The review comes back either way.
       */
      if (isReportableSendFailure(error)) {
        showToast(`Could not send this review: ${String(error)}`, 'error')
      }
    },
  )

  return (
    <>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <DiffCodeView
          files={files}
          isLoading={isLoading}
          loadError={loadError}
          onRetryLoad={onRetryLoad}
          fileNavigation={fileNavigation}
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
        <WorkspaceTreePanel open={workspaceTreeOpen}>
          <FileTree files={deferredTreeFiles} onFileClick={onFileClick} />
        </WorkspaceTreePanel>
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
