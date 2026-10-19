import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { AgentKernelRunResult } from '../../../ports/agent-kernel-service'
import { logger } from './constants'
import type { PiEntryNodeIds } from './pi-entry-node-ids'
import {
  describePiRunError,
  type PiOperationOutcome,
  runPiOperation,
} from './run-lifecycle-failure'
import { projectPiSessionSnapshot } from './session-projection'

/**
 * How long a stopped Run waits for Pi's post-loop work before the Host settles it anyway.
 *
 * After the agent loop returns, Pi still runs `agent_before_settle` handlers, and a handler may run
 * a lint or test gate for minutes. Pi aborts their `ctx.signal` on Stop, but a handler that ignores
 * it would hold the Run in "Finishing" until it returns. After this grace the Host stops waiting.
 */
export const PI_ABORTED_RUN_SETTLE_GRACE_MS = 5_000

export type PiOperationWithinAbortGraceOutcome =
  | PiOperationOutcome
  | {
      /** The Run was stopped and Pi's post-loop work outlived the grace; the Host settles anyway. */
      readonly status: 'abandoned'
    }

/**
 * Whether Pi's agent loop has returned: Pi's own signal exists only while the loop runs. Work left
 * then is post-loop (before-settle handlers, compaction, settled handlers), which writes no tool
 * result the Host would miss. A loop still running a tool that ignores its abort keeps the Run.
 */
function agentLoopReturned(session: AgentSession) {
  return session.agent.signal === undefined
}

/**
 * Runs the Pi operation of a Run. Once the Run is stopped, it waits at most the grace for the
 * operation, repeating while the agent loop itself is still running, and then reports the operation
 * abandoned so the Host settles the Run without it.
 */
export async function runPiOperationWithinAbortGrace(input: {
  readonly operation: () => Promise<void>
  readonly signal: AbortSignal
  readonly session: AgentSession
  readonly graceMs?: number
}): Promise<PiOperationWithinAbortGraceOutcome> {
  const graceMs = input.graceMs ?? PI_ABORTED_RUN_SETTLE_GRACE_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const abandoned = new Promise<PiOperationWithinAbortGraceOutcome>((resolve) => {
    const schedule = () => {
      timer = setTimeout(() => {
        if (!agentLoopReturned(input.session)) {
          schedule()
          return
        }
        logger.warn('A stopped Run settles without waiting for Pi post-run work any longer', {
          graceMs,
        })
        resolve({ status: 'abandoned' })
      }, graceMs)
    }
    onAbort = schedule
    if (input.signal.aborted) schedule()
    else input.signal.addEventListener('abort', schedule, { once: true })
  })
  try {
    return await Promise.race([runPiOperation(input.operation), abandoned])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort) input.signal.removeEventListener('abort', onAbort)
  }
}

export function createAbortListener(session: AgentSession, warning: string) {
  return () => {
    void abortPiSession(session, warning)
  }
}

async function abortPiSession(session: AgentSession, warning: string) {
  await session.abort().catch((error) => {
    logger.warn(warning, {
      error: describePiRunError(error),
    })
  })
}

export async function abortPreCancelledRun(
  session: AgentSession,
  nodeIds: PiEntryNodeIds,
  warning: string,
) {
  await abortPiSession(session, warning)
  return {
    newMessages: [],
    piSessionId: session.sessionId,
    piSessionFile: session.sessionFile,
    sessionSnapshot: projectPiSessionSnapshot(session, nodeIds),
    aborted: true,
  } satisfies AgentKernelRunResult
}
