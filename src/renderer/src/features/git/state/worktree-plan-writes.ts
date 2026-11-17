import type { SessionId } from '@shared/types/brand'
import { draftWorktreePlanKey, PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY } from './worktree-plan-store'

/**
 * The composer strip's plan key, which the strip writes its picks under and the send path reads
 * before sending. One definition, so a pick and the send that follows it can never address
 * different keys.
 */
export function worktreePlanKey(input: {
  readonly sessionId: SessionId | null
  readonly projectPath: string | null
  readonly isFirstMessage: boolean
}) {
  if (input.sessionId) return String(input.sessionId)
  if (input.projectPath) return draftWorktreePlanKey(input.projectPath)
  return input.isFirstMessage ? PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY : ''
}

/** Plan writes still travelling to the Host, by plan key. */
const pendingWrites = new Map<string, Promise<void>>()

function forgetWhenSettled(key: string, settled: Promise<void>) {
  void settled.then(() => {
    if (pendingWrites.get(key) === settled) pendingWrites.delete(key)
  })
}

/**
 * Track the Host write a plan pick started. A pick on an existing Session is a Session Control
 * handoff, so the plan the Host knows changes a round trip later.
 */
export function trackWorktreePlanWrite(key: string, write: Promise<unknown>) {
  if (!key) return
  const settled = write.then(
    () => undefined,
    () => undefined,
  )
  pendingWrites.set(key, settled)
  forgetWhenSettled(key, settled)
}

/**
 * The pick still travelling to the Host for this plan key, if any. A send must not reach the Host
 * before it: the first worktree is born from the base ref the Host has recorded, so a send that
 * overtakes a pick forks from the previous ref, and the branch the user chose appeared to be
 * ignored.
 *
 * Returned rather than awaited so the send stays synchronous when no pick is in flight. A send
 * that always deferred by a tick broke callers that dispatch inside the submit handler.
 */
export function pendingWorktreePlanWrite(key: string) {
  return pendingWrites.get(key)
}
