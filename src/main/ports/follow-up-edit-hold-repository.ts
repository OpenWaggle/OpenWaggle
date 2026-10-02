import type { FollowUpEditHoldReference } from '@shared/types/session-control-queue'
import { Context, type Effect } from 'effect'
import type { SessionControlRepositoryError } from '../errors'

export type { FollowUpEditHoldReference }

export interface ExpiredFollowUpEditHold extends FollowUpEditHoldReference {
  readonly holderCallerId: string
}

/** Lease operations on Follow-up edit holds (ADR 0044). Holds die with the Host. */
export interface FollowUpEditHoldRepositoryShape {
  /** Extends a live hold of `holderCallerId`; `false` once the hold is gone. */
  readonly renew: (
    input: FollowUpEditHoldReference & { readonly holderCallerId: string },
  ) => Effect.Effect<boolean, SessionControlRepositoryError>
  /**
   * One Host sweep: every live hold misses a sweep. Returns the holds whose lease ran out, of
   * Sessions that still exist; they stay listed until a cancel for them is accepted, so a failed
   * release is retried.
   */
  readonly advanceLeases: () => Effect.Effect<
    readonly ExpiredFollowUpEditHold[],
    SessionControlRepositoryError
  >
  /** Sessions waiting on a Follow-up edit, mapped to the earliest live hold's acquisition time. */
  readonly heldSessions: () => Effect.Effect<
    ReadonlyMap<string, number>,
    SessionControlRepositoryError
  >
  /** Keeps attachments an edit names for a while after nothing references them. */
  readonly retainAttachments: (input: {
    readonly sessionId: string
    readonly attachmentIds: readonly string[]
  }) => Effect.Effect<void, SessionControlRepositoryError>
}

export class FollowUpEditHoldRepository extends Context.Tag(
  '@openwaggle/FollowUpEditHoldRepository',
)<FollowUpEditHoldRepository, FollowUpEditHoldRepositoryShape>() {}
