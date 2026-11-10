import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import * as Effect from 'effect/Effect'
import { HiveAncestry } from '../ports/hive-ancestry'

/**
 * Whether a Host event may have started or settled a Run, which changes the Running Workers and
 * the Done-below time of every ancestor of that Session (ADR 0065). A Run is created by a Session
 * Control mutation and settles with `run-settled` or `follow-up-started`, each published as
 * `session-state-changed`; `agent_start` and `agent_end` also cover a Run that began or ended
 * outside those paths.
 */
export function mayChangeWorkerRuns(payload: SessionHostEventPayload) {
  if (payload.kind === 'session-state-changed') return true
  return (
    payload.kind === 'session-transport' &&
    (payload.event.type === 'agent_start' || payload.event.type === 'agent_end')
  )
}

/**
 * Tells windows to read the catalog entry of every ancestor of a Session whose Run changed, so a
 * parent's row, header and rail dot follow its Workers (ADR 0065). A catalog-only list change: no
 * Hive query, discovery index or notification reacts to it, and it never triggers itself.
 */
export function refreshHiveAncestors(
  payload: SessionHostEventPayload,
  publish: (payload: SessionHostEventPayload) => void,
) {
  return Effect.gen(function* () {
    if (!mayChangeWorkerRuns(payload) || !('sessionId' in payload)) return
    const ancestry = yield* HiveAncestry
    const ancestors = yield* ancestry.ancestorsOf(payload.sessionId)
    for (const ancestorId of ancestors) {
      publish({
        kind: 'session-list-changed',
        sessionId: ancestorId,
        change: 'updated',
        catalogOnly: true,
      })
    }
  })
}
