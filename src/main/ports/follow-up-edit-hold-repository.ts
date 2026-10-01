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
  /** Extends a live hold of `holderCallerId`; resolves to its new expiry, or none if it is gone. */
  readonly renew: (
    input: FollowUpEditHoldReference & { readonly holderCallerId: string },
  ) => Effect.Effect<number | undefined, SessionControlRepositoryError>
  /** Removes holds whose lease ran out and returns those of Sessions that still exist. */
  readonly takeExpired: () => Effect.Effect<
    readonly ExpiredFollowUpEditHold[],
    SessionControlRepositoryError
  >
  /** Sessions waiting on a Follow-up edit, mapped to the earliest live hold's acquisition time. */
  readonly heldSessions: () => Effect.Effect<
    ReadonlyMap<string, number>,
    SessionControlRepositoryError
  >
}

export class FollowUpEditHoldRepository extends Context.Tag(
  '@openwaggle/FollowUpEditHoldRepository',
)<FollowUpEditHoldRepository, FollowUpEditHoldRepositoryShape>() {}
