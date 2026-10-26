/**
 * Who acts next on a Hive member (ADR 0059, #380).
 *
 * - `user`: only the person can unblock it: a parked approval or question, or a stuck Worker.
 * - `parent`: the Session that spawned it has to act: review a result, see a failure, answer.
 * - `worker`: the Worker itself carries on.
 * - `none`: the Delegation is closed (accepted or cancelled).
 */
export const HIVE_NEXT_ACTORS = ['user', 'parent', 'worker', 'none'] as const
export type HiveNextActor = (typeof HIVE_NEXT_ACTORS)[number]

/**
 * Why a Delegation is `needs_attention`, persisted by the Session Host (migration 74):
 * `run_failed` when the Host set it for a failed or interrupted Run, `worker_request` when the
 * Worker asked its parent for help with `delegation_state`.
 */
export const HIVE_ATTENTION_CAUSES = ['run_failed', 'worker_request'] as const
export type HiveAttentionCause = (typeof HIVE_ATTENTION_CAUSES)[number]

/** A request a Run parked for the person: an authorization approval, or any other question. */
export const HIVE_PENDING_REQUESTS = ['approval', 'question'] as const
export type HivePendingRequest = (typeof HIVE_PENDING_REQUESTS)[number]
