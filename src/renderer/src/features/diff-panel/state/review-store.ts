import { matchBy } from '@diegogbrisa/ts-match'
import type { ReviewComment } from '@shared/types/review'
import { create } from 'zustand'
import type { ReviewCommentWithSnippet } from '@/features/diff-panel/lib/review-comment-payload'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'

export type ReviewCommentLineType = 'add' | 'remove' | 'context'

/** Where a comment is anchored. A range when the user selected several lines. */
export interface ReviewCommentLocation {
  readonly filePath: string
  readonly line: number
  readonly endLine?: number
  readonly lineType: ReviewCommentLineType
}

/** One pending review: the comments, the composer, and the optional summary. */
interface ReviewThread {
  readonly comments: readonly ReviewCommentWithSnippet[]
  readonly activeCommentLocation: ReviewCommentLocation | null
  readonly summary: string
}

const EMPTY_THREAD: ReviewThread = {
  comments: [],
  activeCommentLocation: null,
  summary: '',
}

interface ReviewState {
  /**
   * Pending reviews keyed by the tree and scope they were written against.
   *
   * This was a single flat list. Nothing cleared it on a session, working-path or scope change,
   * so comments written in one session stayed pending while another was open and submitting posted
   * them into that other conversation - with file and line anchors that meant something else
   * there. Keying by review scope isolates them without discarding what the user typed, which
   * clearing on switch would have done. `diff-scope-store` already established this convention.
   */
  byReviewKey: Record<string, ReviewThread>

  addComment: (reviewKey: string, comment: ReviewCommentWithSnippet) => void
  removeComment: (reviewKey: string, id: string) => void
  clearComments: (reviewKey: string) => void
  setActiveCommentLocation: (reviewKey: string, location: ReviewCommentLocation | null) => void
  setSummary: (reviewKey: string, summary: string) => void
  /** Abandon one pending review without sending it. */
  discardReview: (reviewKey: string) => void
  /**
   * Move a pending review to a new key, keeping whatever is already there.
   *
   * Used when a lazily created session takes over from the working path as the thread key.
   */
  migrateReview: (fromReviewKey: string, toReviewKey: string) => void
  /**
   * Put a review back after a failed send.
   *
   * Submission removes the comments before awaiting, so a rapid double-click cannot send the same
   * review twice. That would otherwise destroy the reviewer's work whenever the send rejects.
   */
  restoreReview: (
    reviewKey: string,
    comments: readonly ReviewCommentWithSnippet[],
    summary: string,
  ) => void
}

/**
 * Drop reviews that hold nothing.
 *
 * Every key the panel touched was retained forever - a session id and scope per diff ever opened,
 * including sessions since deleted - so the store grew without bound for the life of the process.
 * An empty review carries no user work, so forgetting it loses nothing.
 */
function withoutEmptyThreads(byReviewKey: Record<string, ReviewThread>) {
  return Object.fromEntries(
    Object.entries(byReviewKey).filter(
      ([, thread]) =>
        thread.comments.length > 0 ||
        thread.summary.trim().length > 0 ||
        thread.activeCommentLocation !== null,
    ),
  )
}

/** Keep the first occurrence of each comment id, preserving order. */
function dedupeById(
  comments: readonly ReviewCommentWithSnippet[],
): readonly ReviewCommentWithSnippet[] {
  const seen = new Set<string>()
  return comments.filter((comment) => {
    if (seen.has(comment.id)) return false
    seen.add(comment.id)
    return true
  })
}

/** The draft the user is looking at, falling back to the summary that was submitted. */
function chooseSummary(draft: string, submitted: string) {
  return draft.trim().length > 0 ? draft : submitted
}

function updateThread(
  state: Pick<ReviewState, 'byReviewKey'>,
  reviewKey: string,
  change: (thread: ReviewThread) => ReviewThread,
) {
  const current = state.byReviewKey[reviewKey] ?? EMPTY_THREAD
  return {
    byReviewKey: withoutEmptyThreads({ ...state.byReviewKey, [reviewKey]: change(current) }),
  }
}

export const useReviewStore = create<ReviewState>((set) => ({
  byReviewKey: {},

  addComment(reviewKey: string, comment: ReviewCommentWithSnippet) {
    set((state) =>
      updateThread(state, reviewKey, (thread) => ({
        ...thread,
        comments: [...thread.comments, comment],
        activeCommentLocation: null,
      })),
    )
  },

  removeComment(reviewKey: string, id: string) {
    set((state) =>
      updateThread(state, reviewKey, (thread) => ({
        ...thread,
        comments: thread.comments.filter((comment) => comment.id !== id),
      })),
    )
  },

  clearComments(reviewKey: string) {
    set((state) => updateThread(state, reviewKey, () => EMPTY_THREAD))
  },

  setActiveCommentLocation(reviewKey: string, location: ReviewCommentLocation | null) {
    set((state) =>
      updateThread(state, reviewKey, (thread) => ({ ...thread, activeCommentLocation: location })),
    )
  },

  setSummary(reviewKey: string, summary: string) {
    set((state) => updateThread(state, reviewKey, (thread) => ({ ...thread, summary })))
  },

  discardReview(reviewKey: string) {
    set((state) => updateThread(state, reviewKey, () => EMPTY_THREAD))
  },

  migrateReview(fromReviewKey: string, toReviewKey: string) {
    set((state) => {
      const source = state.byReviewKey[fromReviewKey]
      if (fromReviewKey === toReviewKey || source === undefined) return state
      const target = state.byReviewKey[toReviewKey] ?? EMPTY_THREAD
      const merged: ReviewThread = {
        comments: dedupeById([...source.comments, ...target.comments]),
        activeCommentLocation: target.activeCommentLocation ?? source.activeCommentLocation,
        summary: chooseSummary(target.summary, source.summary),
      }
      const { [fromReviewKey]: _moved, ...rest } = state.byReviewKey
      return { byReviewKey: withoutEmptyThreads({ ...rest, [toReviewKey]: merged }) }
    })
  },

  restoreReview(reviewKey: string, comments: readonly ReviewCommentWithSnippet[], summary: string) {
    set((state) =>
      updateThread(state, reviewKey, (thread) => ({
        ...thread,
        /*
         * Restored comments come first, which is chronological: they were written before anything
         * added while the send was in flight. Ids are de-duplicated because a restore can race with
         * the user re-adding the same comment, which otherwise left two copies.
         */
        comments: dedupeById([...comments, ...thread.comments]),
        /*
         * The submitted summary wins over an empty draft, and a draft written during the flight wins
         * over the submitted one - but only when it is actually different, so restoring cannot
         * silently discard the text that was sent.
         */
        summary: chooseSummary(thread.summary, summary),
      })),
    )
  },
}))

/**
 * The key a pending review belongs to: the working tree, plus the scope within it.
 *
 * Includes the whole scope identity, not just its kind. A comment's line anchors and captured snippet
 * only mean anything within the diff they were written against - and turn 7's diff is not turn 2's, nor
 * is `main...HEAD` the same patch as `develop...HEAD`. Keying on the kind alone let a review written
 * against one turn or base ref reappear on another, where those line numbers point somewhere else.
 *
 * The thread key is the session id once one exists and the working path before that, so two sessions
 * sharing one checkout keep separate reviews. Creating a session therefore moves the key underneath a
 * review already in progress, which is why {@link ReviewState.migrateReview} exists: without it the
 * panel started reading an empty thread while the user's comments sat under the old key, invisible,
 * unreachable, and never pruned because they were not empty.
 */
export function reviewKeyFor(threadKey: string | null, selection: DiffScopeSelection): string {
  const scope = matchBy(selection, 'kind')
    .with('branch', (value) => `branch:${value.baseRef ?? ''}`)
    .with('turn', (value) => `turn:${value.turnId}`)
    .with('unstaged', () => 'unstaged')
    .exhaustive()
  return `${threadKey ?? ''}::${scope}`
}

/** Read one pending review, defaulting to empty rather than undefined. */
export function selectReviewThread(
  state: Pick<ReviewState, 'byReviewKey'>,
  reviewKey: string,
): ReviewThread {
  return state.byReviewKey[reviewKey] ?? EMPTY_THREAD
}

/** Legacy alias kept so callers that only need the base shape still compile. */
export type { ReviewComment }
