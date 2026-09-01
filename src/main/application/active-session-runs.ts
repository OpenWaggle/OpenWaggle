import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentKernelRunControl } from '../ports/agent-kernel-service'
import { ActiveRunManager } from './active-run-manager'

export interface AgentRunControlMetadata {
  readonly controlRef: { current: AgentKernelRunControl | null }
  readonly steerTailRef: { current: Promise<void> }
}

interface AgentModelMetadata {
  readonly model: SupportedModelId
}

interface AgentRunMetadata extends AgentModelMetadata, AgentRunControlMetadata {}

const activeRuns = new ActiveRunManager<SessionId, AgentRunMetadata>()
const activeCompactions = new ActiveRunManager<SessionId, AgentModelMetadata>()
const activeWaggleRuns = new ActiveRunManager<SessionId, AgentRunControlMetadata>()
const ACTIVE_RUN_POLL_INTERVAL_MS = 50

export { activeCompactions, activeRuns, activeWaggleRuns }

export function hasAnyActiveRun(sessionId: SessionId): boolean {
  return (
    activeRuns.has(sessionId) || activeCompactions.has(sessionId) || activeWaggleRuns.has(sessionId)
  )
}

export function cancelSessionRuns(sessionId: SessionId): boolean {
  const cancelledAgent = activeRuns.cancel(sessionId)
  const cancelledCompaction = activeCompactions.cancel(sessionId)
  const cancelledWaggle = activeWaggleRuns.cancel(sessionId)
  return cancelledAgent || cancelledCompaction || cancelledWaggle
}

export function getAllActiveRunSessionIds(): SessionId[] {
  return [
    ...new Set([...activeRuns.keys(), ...activeCompactions.keys(), ...activeWaggleRuns.keys()]),
  ]
}

export function cancelAllSessionRuns(): SessionId[] {
  const sessionIds = getAllActiveRunSessionIds()
  activeRuns.cancelAll()
  activeCompactions.cancelAll()
  activeWaggleRuns.cancelAll()
  return sessionIds
}

export async function waitForSessionRuns(sessionId: SessionId, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (hasAnyActiveRun(sessionId) && Date.now() < deadline) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(ACTIVE_RUN_POLL_INTERVAL_MS, deadline - Date.now())),
    )
  }
  return !hasAnyActiveRun(sessionId)
}
