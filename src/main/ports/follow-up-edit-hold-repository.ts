import { Context, type Effect } from 'effect'
import type { SessionControlRepositoryError } from '../errors'

export interface FollowUpEditHoldReference {
  readonly sessionId: string
  readonly followUpId: string
  readonly holdId: string
}

export interface ExpiredFollowUpEditHold extends FollowUpEditHoldReference {
  readonly holderCallerId: string
}

/** Lease operations on Follow-up edit holds (ADR 0043). Holds die with the Host. */
export interface FollowUpEditHoldRepositoryShape {
  /** Extends a live hold of `holderCallerId`; `false` once the hold is gone. */
  readonly renew: (
    input: FollowUpEditHoldReference & { readonly holderCallerId: string },
  ) => Effect.Effect<boolean, SessionControlRepositoryError>
  /**
   * Holds whose lease ran out, of Sessions that still exist. They stay listed until a cancel for
   * them is accepted, so a failed release is retried.
   */
  readonly listExpired: () => Effect.Effect<
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
