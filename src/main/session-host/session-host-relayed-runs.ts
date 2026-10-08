import type { SessionId } from '@shared/types/brand'
import { durableSessionRunId } from '../domain/session-control/root-session-project-reach'

/*
 * The Runs the renderer bridge relayed, for the settlements a lost stretch of the Host's events
 * hid: a resync, or a Run's start the bridge relays while its buffer still holds the Run before.
 * Every settlement it makes up names the Run's durable id, the classic Run behind a requested
 * Waggle (`waggle-of-<X>` settles as X), as the Host's own settlements do.
 */

/** The Run whose hand-off to a queued Follow-up the bridge relayed, by Session (durable id). */
const handedOffRunIds = new Map<SessionId, string>()

/** Whether two Run ids, the one the bridge relayed and the Host's, name different Runs. */
export function namesAnotherRun(relayed: string | undefined, current: string | undefined) {
  return (
    relayed !== undefined &&
    current !== undefined &&
    durableSessionRunId(relayed) !== durableSessionRunId(current)
  )
}

/** The Host's settlement of a Run the bridge relays: a hand-off to the next is remembered. */
export function noteRelayedSettlement(sessionId: SessionId, runId: string, continues: boolean) {
  if (continues) handedOffRunIds.set(sessionId, durableSessionRunId(runId))
  else handedOffRunIds.delete(sessionId)
}

/**
 * The settlement the bridge relays for the Run its buffer held (`runId`, unknown from an older
 * Host), which settled unseen: handing off to the Run the Host runs now (`continues`), or with the
 * Session idle. `null` when it already relayed that hand-off; the idle Session is settled unnamed
 * then, its Run's own settlement having gone by.
 */
export function missedSettlement(
  sessionId: SessionId,
  runId: string | undefined,
  continues: boolean,
): { readonly runId?: string; readonly continues?: true } | null {
  const handedOff = handedOffRunIds.get(sessionId)
  handedOffRunIds.delete(sessionId)
  const durable = runId === undefined ? undefined : durableSessionRunId(runId)
  const relayed = durable === undefined || durable === handedOff
  if (continues) return relayed ? null : { runId: durable, continues: true }
  return relayed ? {} : { runId: durable }
}
