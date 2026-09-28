import type { ActiveAgentRunInfo } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'

interface ActiveRunState {
  readonly activeRunIds: Set<SessionId>
  readonly runModelBySessionId: Map<SessionId, SupportedModelId>
}

/**
 * Marks a Session busy. `model` is the model the Run started with, as the Host reports it on
 * `agent_start`; it is kept apart from the Session's durable model, which a mid-turn switch changes
 * for the next Run only.
 */
export function addActiveRunToState(
  state: ActiveRunState,
  id: SessionId,
  model?: SupportedModelId,
) {
  const hasRun = state.activeRunIds.has(id)
  const runModel =
    model !== undefined && state.runModelBySessionId.get(id) !== model ? model : undefined
  if (hasRun && runModel === undefined) return state
  return {
    ...(hasRun ? {} : { activeRunIds: new Set([...state.activeRunIds, id]) }),
    ...(runModel === undefined
      ? {}
      : { runModelBySessionId: new Map(state.runModelBySessionId).set(id, runModel) }),
  }
}

export function removeActiveRunFromState(state: ActiveRunState, id: SessionId) {
  if (!state.activeRunIds.has(id) && !state.runModelBySessionId.has(id)) return state
  const activeRunIds = new Set(state.activeRunIds)
  activeRunIds.delete(id)
  const runModelBySessionId = new Map(state.runModelBySessionId)
  runModelBySessionId.delete(id)
  return { activeRunIds, runModelBySessionId }
}

/** Restores Run models after a reconnect; a live `agent_start` seen meanwhile names the newer Run. */
export function mergeRestoredRunModels(
  live: ReadonlyMap<SessionId, SupportedModelId>,
  activeRunIds: ReadonlySet<SessionId>,
  runs: readonly ActiveAgentRunInfo[],
) {
  return new Map([
    ...runs
      .filter((run) => activeRunIds.has(run.sessionId))
      .map((run) => [run.sessionId, run.model] as const),
    ...live,
  ])
}
