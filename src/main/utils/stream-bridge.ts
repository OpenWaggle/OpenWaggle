import type {
  WorktreeLaunchProgress,
  WorktreeLaunchSnapshot,
  WorktreeLaunchStep,
} from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { AgentRunCompletedPayload } from '@shared/types/ipc-events'
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
  listStreamBufferSnapshots,
  listStreamBuffers,
  replaceStreamBufferSnapshots,
  setWorktreeLaunchSnapshot,
  startStreamBuffer,
  startStreamBufferFromAgentStart,
  upsertStreamBufferRunIdentity,
} from './stream-buffer'

export function emitRunCompleted(
  sessionId: SessionId,
  details: Omit<AgentRunCompletedPayload, 'sessionId'> = {},
) {
  broadcastToWindows('agent:run-completed', { sessionId, ...details })
}

function appendLaunchDetails(existing: readonly string[] | undefined, incoming: readonly string[]) {
  return [...new Set([...(existing ?? []), ...incoming])]
}

const LAUNCH_COMPLETION_STAGES: ReadonlySet<WorktreeLaunchProgress['stage']> = new Set([
  'worktree-created',
  'starting-task',
])

function closeStep(step: WorktreeLaunchStep, now: number): WorktreeLaunchStep {
  return step.completedAt === undefined ? { ...step, completedAt: now } : step
}

/**
 * Fold one progress report into the launch's step list.
 *
 * A sequential step closes every open step when it starts, which is how a worktree birth reads:
 * fetch, then check out. A parallel step leaves the others open, because the local branch sync and
 * the MCP connections really do wait at the same time. A completion stage closes everything.
 */
function nextLaunchSteps(
  existing: readonly WorktreeLaunchStep[] | undefined,
  progress: WorktreeLaunchProgress,
  now: number,
): readonly WorktreeLaunchStep[] | undefined {
  const steps = existing ?? []
  if (LAUNCH_COMPLETION_STAGES.has(progress.stage)) {
    return steps.length > 0 ? steps.map((step) => closeStep(step, now)) : existing
  }
  if (progress.completesStep) {
    // A closing report may relabel its step with how it ended.
    return steps.map((step) =>
      step.stage === progress.stage && step.completedAt === undefined
        ? closeStep(progress.label ? { ...step, label: progress.label } : step, now)
        : step,
    )
  }
  if (!progress.label) return existing
  const open = steps.find((step) => step.stage === progress.stage && step.completedAt === undefined)
  if (open?.label === progress.label) return steps
  const settled = progress.parallel ? steps : steps.map((step) => closeStep(step, now))
  return [...settled, { stage: progress.stage, label: progress.label, startedAt: now }]
}

function worktreeLaunchProgressSnapshot(
  existing: WorktreeLaunchSnapshot | undefined,
  progress: WorktreeLaunchProgress,
): WorktreeLaunchSnapshot {
  const now = Date.now()
  const { label: _label, parallel: _parallel, completesStep, ...fields } = progress
  const steps = nextLaunchSteps(existing?.steps, progress, now)
  return {
    ...existing,
    ...fields,
    // Closing a step never reopens a launch that already failed or finished.
    status:
      completesStep && existing
        ? existing.status
        : progress.stage === 'starting-task'
          ? ('complete' as const)
          : ('running' as const),
    // Closing a parallel step reports its stage without making it the launch's latest stage.
    stage: completesStep && existing ? existing.stage : progress.stage,
    startedAt: existing?.startedAt ?? now,
    updatedAt: now,
    details: appendLaunchDetails(existing?.details, progress.details),
    ...(steps ? { steps } : {}),
  }
}

export function projectWorktreeLaunchProgress(
  sessionId: SessionId,
  progress: WorktreeLaunchProgress,
) {
  const launch = worktreeLaunchProgressSnapshot(
    getStreamBuffer(sessionId)?.worktreeLaunch,
    progress,
  )
  setWorktreeLaunchSnapshot(sessionId, launch)
  return launch
}

export function emitWorktreeLaunchProgress(
  sessionId: SessionId,
  progress: WorktreeLaunchProgress,
  options: { readonly projectStreamBuffer?: boolean } = {},
) {
  const launch =
    options.projectStreamBuffer === false
      ? (getStreamBuffer(sessionId)?.worktreeLaunch ??
        worktreeLaunchProgressSnapshot(undefined, progress))
      : projectWorktreeLaunchProgress(sessionId, progress)
  broadcastToWindows('agent:worktree-launch', { sessionId, launch })
}

export function projectWorktreeLaunchFailure(sessionId: SessionId, errorMessage: string) {
  const existing = getStreamBuffer(sessionId)?.worktreeLaunch
  if (!existing || existing.status === 'complete') return null
  const launch = {
    ...existing,
    status: 'failed' as const,
    updatedAt: Date.now(),
    errorMessage,
    details: appendLaunchDetails(existing.details, [errorMessage]),
  }
  setWorktreeLaunchSnapshot(sessionId, launch)
  return launch
}

export function emitWorktreeLaunchFailure(
  sessionId: SessionId,
  errorMessage: string,
  options: { readonly projectStreamBuffer?: boolean } = {},
) {
  const launch =
    options.projectStreamBuffer === false
      ? (getStreamBuffer(sessionId)?.worktreeLaunch ?? {
          status: 'failed' as const,
          stage: 'preparing-workspace' as const,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          errorMessage,
          details: [errorMessage],
        })
      : projectWorktreeLaunchFailure(sessionId, errorMessage)
  if (launch) broadcastToWindows('agent:worktree-launch', { sessionId, launch })
}

export function clearWorktreeLaunch(sessionId: SessionId) {
  setWorktreeLaunchSnapshot(sessionId, null)
  broadcastToWindows('agent:worktree-launch', { sessionId, launch: null })
}

export function emitTransportEvent(
  sessionId: SessionId,
  event: AgentTransportEvent,
  options: { readonly projectStreamBuffer?: boolean } = {},
) {
  if (options.projectStreamBuffer !== false) applyEventToStreamBuffer(sessionId, event)

  maybeEmitPhase({
    sessionId,
    phase: updatePhaseFromTransportEvent(sessionId, event, event.timestamp),
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
