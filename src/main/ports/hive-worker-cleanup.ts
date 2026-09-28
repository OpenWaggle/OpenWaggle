import type { SessionId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'

export interface HiveWorkerCleanupShape {
  /**
   * Schedule a Hive cleanup pass for `sessionId` as a Worker and as a parent of direct Workers.
   * Never blocks the caller and never fails it: cleanup is best-effort and re-derivable.
   */
  readonly requestReconciliation: (sessionId: SessionId) => Effect.Effect<void>
  /**
   * A user or agent command resumed work on `sessionId`. If Hive cleanup archived it, unarchive
   * it now, attributed to `callerId`, and publish the change. Explicit archives stay. Runs
   * inline; the caller must already hold `sessionId`'s command serialization (so this must not
   * take it again). Never fails.
   */
  readonly restoreForCommand: (input: {
    readonly callerId: string
    readonly sessionId: SessionId
    /** The resuming command's idempotency key; the restore derives its own key from it. */
    readonly idempotencyKey: string
  }) => Effect.Effect<void>
}

/**
 * Optional Session Host collaborator. Run settlement, delegation review, and resuming commands look
 * it up with `Effect.serviceOption`, so runtimes and tests that do not provide it keep their
 * behavior.
 */
export class HiveWorkerCleanup extends Context.Tag('@openwaggle/HiveWorkerCleanup')<
  HiveWorkerCleanup,
  HiveWorkerCleanupShape
>() {}
