import { match, P } from '@diegogbrisa/ts-match'
import { parseJsonUnknown } from '@shared/schema'
import { decodeSessionControlMutationOutcome } from '@shared/schemas/session-control'

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
  return match(parseJsonUnknown(json))
    .with(
      { operation: 'steer', effect: 'steered-run', receipt: historicalReceipt },
      { operation: 'promote', effect: 'promoted-follow-up', receipt: historicalReceipt },
      (outcome) =>
        decodeSessionControlMutationOutcome({
          ...outcome,
          receipt: { delivery: 'unavailable' },
        }),
    )
    .otherwise(decodeSessionControlMutationOutcome)
}
