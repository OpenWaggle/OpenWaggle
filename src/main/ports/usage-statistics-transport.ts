import type { UsageStatisticsRequest } from '@shared/usage-statistics/contract'
import { Context } from 'effect'
import type { Effect as EffectType } from 'effect/Effect'

/**
 * How the statistics endpoint answered one request. The endpoint stores a request before it
 * answers 202 and answers 5xx or 429 only when it stored nothing, so only those answers, and a
 * request that provably never left this machine, may be sent again.
 * - `accepted`: any 2xx. The endpoint stored the batch.
 * - `rejected`: any other answer. Sending the same body again cannot succeed.
 * - `retry`: a 5xx or 429, or no connection could be made (DNS, refused, unreachable, connect
 *   timeout). Nothing was stored.
 * - `unknown`: a timeout, abort, reset or other failure after the request may have reached the
 *   endpoint. It may have been stored, so it is never sent again.
 */
export type UsageStatisticsDelivery =
  | { readonly outcome: 'accepted'; readonly status: number }
  | { readonly outcome: 'rejected'; readonly status: number }
  | {
      readonly outcome: 'retry'
      readonly reason: 'endpoint-unavailable' | 'not-connected'
      readonly status?: number
    }
  | { readonly outcome: 'unknown'; readonly reason: string }

export interface UsageStatisticsTransportShape {
  /** POSTs one batch to the statistics endpoint. Never fails; the outcome says what happened. */
  readonly send: (request: UsageStatisticsRequest) => EffectType<UsageStatisticsDelivery>
}

export class UsageStatisticsTransport extends Context.Tag('@openwaggle/UsageStatisticsTransport')<
  UsageStatisticsTransport,
  UsageStatisticsTransportShape
>() {}
