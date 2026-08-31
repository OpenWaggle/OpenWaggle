import type { CodeViewItem } from '@pierre/diffs'
import {
  CodeView,
  type CodeViewHandle,
  useWorkerPool,
  WorkerPoolContextProvider,
} from '@pierre/diffs/react'
import type { GitFileDiff } from '@shared/types/git'
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react'
import { useDiffCodeSelection } from '@/features/diff-panel/hooks/useDiffCodeSelection'
import { useDiffCodeViewReady } from '@/features/diff-panel/hooks/useDiffCodeViewReady'
import {
  type DiffFileNavigation,
  usePreparedDiffFileNavigation,
} from '@/features/diff-panel/hooks/usePreparedDiffFileNavigation'
import { useProgressiveCodeViewItems } from '@/features/diff-panel/hooks/useProgressiveCodeViewItems'
import type { ReviewAnnotationMetadata } from '@/features/diff-panel/lib/code-view-items'
import type { ReviewCommentWithSnippet } from '@/features/diff-panel/lib/review-comment-payload'
import type { ReviewCommentLocation } from '@/features/diff-panel/state/review-store'
import { registerPendingPierreSyntaxResources } from '@/shared/lib/syntax/pierre-syntax-runtime'
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
  readonly files: readonly GitFileDiff[]
  readonly isLoading: boolean
  /** A failed load, which must never be presented as an empty diff. */
  readonly loadError: string | null
  readonly onRetryLoad: () => void
  readonly viewOptions: DiffViewOptions
  readonly review: DiffCodeViewReview
  readonly fileNavigation?: DiffFileNavigation | null
}

function DiffCodeViewReadiness({ children }: { readonly children: ReactNode }) {
  const codeViewReady = useDiffCodeViewReady()
  return (
    <div
      ref={codeViewReady.rootRef}
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      {children}
      {!codeViewReady.ready ? (
        <div className="absolute inset-0 flex items-center justify-center bg-diff-bg">
          <Spinner />
        </div>
      ) : null}
    </div>
  )
}

function DiffWorkerPoolTheme({ theme }: { readonly theme: string }) {
  const workerPool = useWorkerPool()
  useEffect(() => {
    void workerPool?.setRenderOptions({ theme })
  }, [theme, workerPool])
  return null
}

const CODE_VIEW_LAYOUT = { paddingTop: 10, paddingBottom: 10, gap: 10 } as const
const DIFF_AST_CACHE_ENTRIES = 64

function createPierreWorker() {
  return new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' })
}

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

function resolveCodeViewPlaceholder(
  isLoading: boolean,
  loadError: string | null,
  fileCount: number,
  itemsReady: boolean,
) {
  return resolveDiffPlaceholder({
    isLoading: isLoading || (fileCount > 0 && !itemsReady),
    loadError,
    fileCount,
  })
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
    <div className="flex flex-1 items-center justify-center text-xs text-text-tertiary">
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
      /*
       * Honour the side the comment was written against, as the draft marker already does. Pinning
       * saved markers to the additions column moved a comment on a deleted line onto unrelated
       * code at the same line number, while the payload still named the old line.
       */
      side: annotationSide(comment.lineType ?? 'add'),
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

/**
 * Match the item id exactly. A suffix test resolves `diff:docs/README.md` to `README.md` whenever
 * both exist, moving review comments and their snippets onto a file the reviewer never selected.
 */
function buildPatchByPath(files: readonly GitFileDiff[]) {
  return new Map(files.map((file) => [file.path, file.diff] as const))
}

function useDiffAnnotationRenderer(review: DiffCodeViewReview) {
  return useCallback(
    (
      annotation: { metadata?: ReviewAnnotationMetadata | undefined },
      item: CodeViewItem<ReviewAnnotationMetadata>,
    ) => {
      const metadata = annotation.metadata
      if (metadata === undefined) return null
      if (metadata.kind === 'pending') {
        const comment = review.comments.find((entry) => entry.id === metadata.commentId)
        if (comment === undefined) return null
        return (
          <PendingComment comment={comment} onRemove={() => review.onRemoveComment(comment.id)} />
        )
      }
      const location = review.activeCommentLocation
      if (location === null || location.filePath !== filePathOfItem(item)) return null
      return (
        <InlineComment
          startLine={location.line}
          endLine={location.endLine ?? location.line}
          hasPendingReview={review.comments.length > 0}
          onAddSingleComment={(content) => review.onAddSingleComment(location, content)}
          onAddToReview={(content) => review.onAddToReview(location, content)}
          onCancel={() => review.onSetActiveComment(null)}
        />
      )
    },
    [review],
  )
}

export function DiffCodeView({
  files,
  isLoading,
  loadError,
  onRetryLoad,
  viewOptions,
  review,
  fileNavigation = null,
}: DiffCodeViewProps) {
  const viewerRef = useRef<CodeViewHandle<ReviewAnnotationMetadata>>(null)
  const patchByPath = useMemo(() => buildPatchByPath(files), [files])
  const [selection, handleSelectionChange] = useDiffCodeSelection(
    patchByPath,
    review.onSetActiveComment,
  )

  const annotationsByPath = useMemo(
    () => buildAnnotationsByPath(review.comments, review.activeCommentLocation),
    [review.comments, review.activeCommentLocation],
  )
  const {
    items,
    preparedPaths,
    error: preparationError,
  } = useProgressiveCodeViewItems(files, annotationsByPath)
  usePreparedDiffFileNavigation(viewerRef, fileNavigation, preparedPaths)

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
  const renderAnnotation = useDiffAnnotationRenderer(review)

  const effectiveLoadError = loadError ?? preparationError
  const placeholder = resolveCodeViewPlaceholder(
    isLoading,
    effectiveLoadError,
    files.length,
    items !== null,
  )
  if (placeholder !== 'diff') {
    return (
      <DiffPlaceholder
        kind={placeholder}
        message={effectiveLoadError ?? ''}
        onRetryLoad={onRetryLoad}
      />
    )
  }

  registerPendingPierreSyntaxResources()
  return (
    <DiffCodeViewReadiness>
      <WorkerPoolContextProvider
        poolOptions={{
          workerFactory: createPierreWorker,
          poolSize: 1,
          totalASTLRUCacheSize: DIFF_AST_CACHE_ENTRIES,
        }}
        highlighterOptions={{ theme: viewOptions.syntaxTheme }}
      >
        <DiffWorkerPoolTheme theme={viewOptions.syntaxTheme} />
        <CodeView<ReviewAnnotationMetadata>
          ref={viewerRef}
          className="diff-chrome diff-scroll min-h-0 min-w-0 flex-1 overflow-auto"
          items={items ?? []}
          options={options}
          selectedLines={selection}
          onSelectedLinesChange={handleSelectionChange}
          renderAnnotation={renderAnnotation}
        />
      </WorkerPoolContextProvider>
    </DiffCodeViewReadiness>
  )
}
