import type { SessionId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'

export interface HiveWorkerCleanupShape {
  /**
   * Schedule a Hive cleanup pass for `sessionId` as a Worker and as a parent of direct Workers.
   * Never blocks the caller and never fails it: cleanup is best-effort and re-derivable.
   */
  readonly requestReconciliation: (sessionId: SessionId) => Effect.Effect<void>
}

/**
 * Optional Session Host collaborator. Run settlement and delegation review look it up with
 * `Effect.serviceOption`, so runtimes and tests that do not provide it keep their behavior.
 */
export class HiveWorkerCleanup extends Context.Tag('@openwaggle/HiveWorkerCleanup')<
  HiveWorkerCleanup,
  HiveWorkerCleanupShape
>() {}
