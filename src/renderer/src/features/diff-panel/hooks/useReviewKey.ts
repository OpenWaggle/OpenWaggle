import {
  type DiffScopeSelection,
  useDiffScopeStore,
} from '@/features/diff-panel/state/diff-scope-store'
import { reviewKeyFor } from '@/features/diff-panel/state/review-store'

/**
 * The key the panel's pending review lives under, plus a way to name the key for a session that does not
 * exist yet.
 *
 * Threads are keyed by session id once one exists and by working path before that, so two sessions sharing one
 * checkout keep separate reviews.
 *
 * There is deliberately no automatic migration between the two. A draft review does move when it matters -
 * a failed first send carries the id of the session it created, and the review follows it there - but that is
 * driven by an event that knows *which* session, rather than inferred from the panel's key changing. Four
 * successive attempts to infer it were each wrong: the key also changes when the user clicks an existing
 * session in the sidebar, and in local mode every session in a project shares one working path, so a draft
 * review was claimed by another session and merged into its thread - posting one session's comments into
 * another conversation, which is exactly what keying reviews was introduced to prevent. Without the inference
 * an unsubmitted draft simply stays under the working path and reappears whenever the panel is on the draft:
 * nothing is lost and nothing is misfiled.
 */
export function useReviewKey(input: {
  readonly scopeKey: string
  /**
   * What a draft's key is built from: the opened repository, not the session's working path.
   *
   * A draft has no session, so its working path is the opened checkout - but in worktree mode the session's
   * birth moves that path to the new worktree, and a key built from it moved too, leaving the reviewer's work
   * under a path nothing looks at again.
   */
  readonly draftAnchor: string | null
  readonly selection: DiffScopeSelection
}) {
  const selectScopeForThread = useDiffScopeStore((state) => state.setThreadScope)
  const reviewKey = reviewKeyFor(input.scopeKey || null, input.selection)
  const draftKey = reviewKeyFor(input.draftAnchor, input.selection)

  /*
   * Where work submitted from this panel goes when the send that created a session fails, and the scope it goes
   * under - recorded for that session as part of the same step.
   *
   * The key a review lives under carries its scope, so following the session without also settling the scope left
   * a review written in the Branch scope under a key the panel could not show: a new session has no scope of its
   * own and displays the working tree. This is not the inference that was deleted five times over. It is one
   * concrete event - this send created this session, carrying work written in this scope - writing exactly what
   * that event knows, once.
   */
  const keyForSession = (sessionId: string) => {
    selectScopeForThread(sessionId, input.selection)
    return reviewKeyFor(sessionId, input.selection)
  }

  return { reviewKey, draftKey, keyForSession }
}
