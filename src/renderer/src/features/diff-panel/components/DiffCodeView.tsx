import type { CodeViewItem, CodeViewLineSelection } from '@pierre/diffs'
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react'
import type { GitFileDiff } from '@shared/types/git'
import { type Ref, useCallback, useMemo, useState } from 'react'
import {
  buildCodeViewItems,
  codeViewItemId,
  type ReviewAnnotationMetadata,
} from '@/features/diff-panel/lib/code-view-items'
import type { ReviewCommentWithSnippet } from '@/features/diff-panel/lib/review-comment-payload'
import type { ReviewCommentLocation } from '@/features/diff-panel/state/review-store'
import { Spinner } from '@/shared/ui/Spinner'
import { DiffLoadError } from './DiffLoadError'
import { InlineComment } from './InlineComment'
import { PendingComment } from './PendingComment'

export type DiffViewLayout = 'unified' | 'split'

export interface DiffViewOptions {
  readonly syntaxTheme: string
  readonly diffView: DiffViewLayout
  readonly wrapLines: boolean
}

/** Review state and callbacks, grouped so the call site stays a focused boundary. */
export interface DiffCodeViewReview {
  readonly comments: readonly ReviewCommentWithSnippet[]
  readonly activeCommentLocation: ReviewCommentLocation | null
  readonly onSetActiveComment: (location: ReviewCommentLocation | null) => void
  readonly onAddSingleComment: (location: ReviewCommentLocation, content: string) => void
  readonly onAddToReview: (location: ReviewCommentLocation, content: string) => void
  readonly onRemoveComment: (id: string) => void
}

interface DiffCodeViewProps {
  readonly viewerRef?: Ref<CodeViewHandle<ReviewAnnotationMetadata>>
  readonly files: readonly GitFileDiff[]
  readonly isLoading: boolean
  /** A failed load, which must never be presented as an empty diff. */
  readonly loadError: string | null
  readonly onRetryLoad: () => void
  readonly viewOptions: DiffViewOptions
  readonly review: DiffCodeViewReview
}

const CODE_VIEW_LAYOUT = { paddingTop: 10, paddingBottom: 10, gap: 10 } as const

/**
 * Which non-diff state to show, if any.
 *
 * The order matters: a failed load must be checked before emptiness, or every failure - not a
 * repository, an unresolvable base ref, a vanished worktree, a transport error - reads as "no
 * changes", telling the user their work is committed when the tree could not be read at all.
 */
function resolveDiffPlaceholder(input: {
  readonly isLoading: boolean
  readonly loadError: string | null
  readonly fileCount: number
}) {
  if (input.isLoading) return 'loading'
  if (input.loadError !== null) return 'error'
  return input.fileCount === 0 ? 'empty' : 'diff'
}

/** Loading, failed, or empty - anything other than an actual diff. */
function DiffPlaceholder({
  kind,
  message,
  onRetryLoad,
}: {
  readonly kind: 'loading' | 'error' | 'empty'
  readonly message: string
  readonly onRetryLoad: () => void
}) {
  if (kind === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (kind === 'error') return <DiffLoadError message={message} onRetry={onRetryLoad} />
  return (
    <div className="flex flex-1 items-center justify-center text-[12px] text-text-tertiary">
      No changes to review
    </div>
  )
}

/**
 * Annotations anchor to the additions side unless the comment targets a removed
 * line: a review of the agent's work is almost always about the new code.
 */
function annotationSide(lineType: ReviewCommentLocation['lineType']) {
  return lineType === 'remove' ? ('deletions' as const) : ('additions' as const)
}

function buildAnnotationsByPath(
  comments: readonly ReviewCommentWithSnippet[],
  draft: ReviewCommentLocation | null,
) {
  const byPath = new Map<string, ReviewAnnotationMetadataAnnotation[]>()
  const push = (filePath: string, annotation: ReviewAnnotationMetadataAnnotation) => {
    const existing = byPath.get(filePath)
    if (existing === undefined) {
      byPath.set(filePath, [annotation])
      return
    }
    existing.push(annotation)
  }

  for (const comment of comments) {
    push(comment.filePath, {
      side: 'additions',
      lineNumber: comment.endLine,
      metadata: { kind: 'pending', filePath: comment.filePath, commentId: comment.id },
    })
  }

  if (draft !== null) {
    push(draft.filePath, {
      side: annotationSide(draft.lineType),
      lineNumber: draft.endLine ?? draft.line,
      metadata: { kind: 'draft', filePath: draft.filePath },
    })
  }

  return byPath
}

type ReviewAnnotationMetadataAnnotation = {
  side: 'additions' | 'deletions'
  lineNumber: number
  metadata: ReviewAnnotationMetadata
}

function filePathOfItem(item: CodeViewItem<ReviewAnnotationMetadata>) {
  return item.type === 'diff' ? item.fileDiff.name : item.file.name
}

export function DiffCodeView({
  viewerRef,
  files,
  isLoading,
  loadError,
  onRetryLoad,
  viewOptions,
  review,
}: DiffCodeViewProps) {
  const {
    comments,
    activeCommentLocation,
    onSetActiveComment,
    onAddSingleComment,
    onAddToReview,
    onRemoveComment,
  } = review
  const [selection, setSelection] = useState<CodeViewLineSelection | null>(null)

  const patchByPath = useMemo(() => {
    const map = new Map<string, string>()
    for (const file of files) map.set(file.path, file.diff)
    return map
  }, [files])

  const items = useMemo(
    () => buildCodeViewItems(files, buildAnnotationsByPath(comments, activeCommentLocation)),
    [files, comments, activeCommentLocation],
  )

  const options = useMemo(
    () => ({
      theme: viewOptions.syntaxTheme,
      diffStyle: viewOptions.diffView,
      overflow: viewOptions.wrapLines ? ('wrap' as const) : ('scroll' as const),
      stickyHeaders: true,
      enableLineSelection: true,
      layout: CODE_VIEW_LAYOUT,
    }),
    [viewOptions.syntaxTheme, viewOptions.diffView, viewOptions.wrapLines],
  )

  const renderAnnotation = useCallback(
    (
      annotation: { metadata?: ReviewAnnotationMetadata | undefined },
      item: CodeViewItem<ReviewAnnotationMetadata>,
    ) => {
      const metadata = annotation.metadata
      if (metadata === undefined) return null

      if (metadata.kind === 'pending') {
        const comment = comments.find((c) => c.id === metadata.commentId)
        if (comment === undefined) return null
        return <PendingComment comment={comment} onRemove={() => onRemoveComment(comment.id)} />
      }

      const location = activeCommentLocation
      if (location === null || location.filePath !== filePathOfItem(item)) return null
      return (
        <InlineComment
          startLine={location.line}
          endLine={location.endLine ?? location.line}
          hasPendingReview={comments.length > 0}
          onAddSingleComment={(content) => onAddSingleComment(location, content)}
          onAddToReview={(content) => onAddToReview(location, content)}
          onCancel={() => onSetActiveComment(null)}
        />
      )
    },
    [
      comments,
      activeCommentLocation,
      onAddSingleComment,
      onAddToReview,
      onRemoveComment,
      onSetActiveComment,
    ],
  )

  const handleSelectionChange = useCallback(
    (next: CodeViewLineSelection | null) => {
      setSelection(next)
      if (next === null) {
        onSetActiveComment(null)
        return
      }
      /*
       * Match the item id exactly. A suffix test resolved `diff:docs/README.md` to `README.md`
       * whenever both were in the diff, so the comment - and the filePath sent to the agent, and
       * the snippet pulled from the patch - named a file the reviewer never looked at.
       * Same-basename files at different depths are routine (index.ts, README.md, package.json).
       */
      const filePath = [...patchByPath.keys()].find((path) => codeViewItemId(path) === next.id)
      if (filePath === undefined) return
      const start = Math.min(next.range.start, next.range.end)
      const end = Math.max(next.range.start, next.range.end)
      onSetActiveComment({
        filePath,
        line: start,
        endLine: end,
        lineType: next.range.side === 'deletions' ? 'remove' : 'add',
      })
    },
    [onSetActiveComment, patchByPath],
  )

  const placeholder = resolveDiffPlaceholder({ isLoading, loadError, fileCount: files.length })
  if (placeholder !== 'diff') {
    return (
      <DiffPlaceholder kind={placeholder} message={loadError ?? ''} onRetryLoad={onRetryLoad} />
    )
  }

  return (
    <CodeView<ReviewAnnotationMetadata>
      ref={viewerRef}
      className="diff-chrome diff-scroll min-h-0 min-w-0 flex-1 overflow-auto"
      items={items}
      options={options}
      selectedLines={selection}
      onSelectedLinesChange={handleSelectionChange}
      renderAnnotation={renderAnnotation}
    />
  )
}
