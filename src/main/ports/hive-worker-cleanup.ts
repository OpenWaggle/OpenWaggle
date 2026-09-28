import type { SessionId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'

export interface HiveWorkerCleanupShape {
  /**
   * Schedule a Hive cleanup pass for `sessionId` as a Worker and as a parent of direct Workers.
   * Never blocks the caller and never fails it: cleanup is best-effort and re-derivable.
   */
  readonly requestReconciliation: (sessionId: SessionId) => Effect.Effect<void>
  /**
   * A user command addressed `sessionId`. If Hive cleanup archived it, unarchive it now,
   * attributed to `callerId`, and publish the change. Runs inline, inside the command's own
   * Session serialization (so it must not take that serialization again), and never fails.
   */
  readonly restoreForUserCommand: (input: {
    readonly callerId: string
    readonly sessionId: SessionId
    /** The user command's idempotency key; the restore derives its own key from it. */
    readonly idempotencyKey: string
  }) => Effect.Effect<void>
}

/**
 * Optional Session Host collaborator. Run settlement, delegation review, and user commands look
 * it up with `Effect.serviceOption`, so runtimes and tests that do not provide it keep their
 * behavior.
 */
export class HiveWorkerCleanup extends Context.Tag('@openwaggle/HiveWorkerCleanup')<
  HiveWorkerCleanup,
  HiveWorkerCleanupShape
>() {}
