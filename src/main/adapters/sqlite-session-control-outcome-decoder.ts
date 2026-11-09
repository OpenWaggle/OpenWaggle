import { match, P } from '@diegogbrisa/ts-match'
import { parseJsonUnknown } from '@shared/schema'
import { decodeSessionControlMutationOutcome } from '@shared/schemas/session-control'
import { withStoredRefusalKind } from './sqlite-stored-refusal-kind'

const historicalReceipt = P.optional(
  P.union(
    P.undefined,
    P.exact({
      delivery: 'queued',
      durableTextSha256: P.regex(/^[a-f0-9]{64}$/),
      minimumCreatedOrder: P.optional(P.undefined),
    }),
  ),
)

/** Historical ACKs cannot prove queued text or hook handling. Preserve success without inventing either. */
export function decodeStoredSessionControlMutationOutcome(json: string) {
  return decodeStoredSessionControlMutationValue(parseJsonUnknown(json))
}

/** `decodeStoredSessionControlMutationOutcome` for a value already parsed from JSON. */
export function decodeStoredSessionControlMutationValue(value: unknown) {
  return match(withStoredRefusalKind(value))
    .with(
      { operation: 'steer', effect: 'steered-run', receipt: historicalReceipt },
      { operation: 'promote', effect: 'promoted-follow-up', receipt: historicalReceipt },
      (outcome) =>
        decodeSessionControlMutationOutcome({
          ...outcome,
          receipt: { delivery: 'unavailable' },
        }),
    )
    .with(
      {
        effect: 'queue-updated',
        followUpIds: P.array(P.string),
        remainingFollowUpIds: P.optional(P.undefined),
      },
      // Before 1.0.0-rc.1 the queue-updated outcome called the remaining queue `followUpIds`.
      ({ followUpIds, ...outcome }) =>
        decodeSessionControlMutationOutcome({ ...outcome, remainingFollowUpIds: followUpIds }),
    )
    .otherwise(decodeSessionControlMutationOutcome)
}
