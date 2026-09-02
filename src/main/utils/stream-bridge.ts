import type { WorktreeLaunchProgress } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { AgentPhaseEventPayload } from '@shared/types/phase'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { WaggleStreamMetadata, WaggleTurnEvent } from '@shared/types/waggle'
import { resetPhaseForSession, updatePhaseFromTransportEvent } from '../agent/phase-tracker'
import { broadcastToWindows } from './broadcast'
import {
  applyEventToStreamBuffer,
  getStreamBuffer,
  setWorktreeLaunchSnapshot,
} from './stream-buffer'

export {
  clearStreamBuffer,
  getStreamBuffer,
  listStreamBuffers,
  setWorktreeLaunchSnapshot,
  startStreamBuffer,
} from './stream-buffer'

export function emitRunCompleted(sessionId: SessionId) {
  broadcastToWindows('agent:run-completed', { sessionId })
}

function appendLaunchDetails(existing: readonly string[] | undefined, incoming: readonly string[]) {
  return [...new Set([...(existing ?? []), ...incoming])]
}

export function emitWorktreeLaunchProgress(sessionId: SessionId, progress: WorktreeLaunchProgress) {
  const now = Date.now()
  const existing = getStreamBuffer(sessionId)?.worktreeLaunch
  const launch = {
    ...existing,
    ...progress,
    status: progress.stage === 'starting-task' ? ('complete' as const) : ('running' as const),
    stage: progress.stage,
    startedAt: existing?.startedAt ?? now,
    updatedAt: now,
    details: appendLaunchDetails(existing?.details, progress.details),
  }
  setWorktreeLaunchSnapshot(sessionId, launch)
  broadcastToWindows('agent:worktree-launch', { sessionId, launch })
}

export function emitWorktreeLaunchFailure(sessionId: SessionId, errorMessage: string) {
  const existing = getStreamBuffer(sessionId)?.worktreeLaunch
  if (!existing || existing.status === 'complete') return
  const launch = {
    ...existing,
    status: 'failed' as const,
    updatedAt: Date.now(),
    errorMessage,
    details: appendLaunchDetails(existing.details, [errorMessage]),
  }
  setWorktreeLaunchSnapshot(sessionId, launch)
  broadcastToWindows('agent:worktree-launch', { sessionId, launch })
}

export function clearWorktreeLaunch(sessionId: SessionId) {
  setWorktreeLaunchSnapshot(sessionId, null)
  broadcastToWindows('agent:worktree-launch', { sessionId, launch: null })
}

export function emitTransportEvent(sessionId: SessionId, event: AgentTransportEvent) {
  applyEventToStreamBuffer(sessionId, event)

  maybeEmitPhase({
    sessionId,
    phase: updatePhaseFromTransportEvent(sessionId, event, Date.now()),
  })

  broadcastToWindows('agent:event', { sessionId, event })
}

export function emitErrorAndFinish(
  sessionId: SessionId,
  message: string,
  code: string,
  runId = '',
) {
  emitTransportEvent(sessionId, {
    type: 'agent_end',
    runId,
    reason: 'error',
    error: { message, code },
    timestamp: Date.now(),
  })
}

export function emitWaggleTransportEvent(
  sessionId: SessionId,
  event: AgentTransportEvent,
  meta: WaggleStreamMetadata,
) {
  broadcastToWindows('waggle:event', { sessionId, event, meta })
}

export function emitWaggleTurnEvent(sessionId: SessionId, event: WaggleTurnEvent) {
  broadcastToWindows('waggle:turn-event', { sessionId, event })
}

export function clearAgentPhase(sessionId: SessionId) {
  const result = resetPhaseForSession(sessionId)
  if (!result.changed) return
  broadcastToWindows('agent:phase', { sessionId, phase: null })
}

function maybeEmitPhase(input: {
  sessionId: SessionId
  phase: { changed: boolean; phase: AgentPhaseEventPayload['phase'] }
}) {
  if (!input.phase.changed) return
  broadcastToWindows('agent:phase', {
    sessionId: input.sessionId,
    phase: input.phase.phase,
  })
}
