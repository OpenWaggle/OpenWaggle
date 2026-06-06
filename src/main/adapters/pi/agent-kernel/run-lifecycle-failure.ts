import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { Message } from '@shared/types/agent'
import type { AgentKernelRunInput, AgentKernelRunResult } from '../../../ports/agent-kernel-service'
import { getPiAssistantStopReason } from '../pi-run-result'
import { waitForPostRunSettlement } from './post-run-settlement'
import { projectPiSessionSnapshot } from './session-projection'

export type PiOperationOutcome =
  | {
      readonly status: 'completed'
    }
  | {
      readonly status: 'failed'
      readonly error: unknown
    }

export function describePiRunError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function runPiOperation(operation: () => Promise<void>): Promise<PiOperationOutcome> {
  try {
    await operation()
    return { status: 'completed' }
  } catch (error) {
    return { status: 'failed', error }
  }
}

export async function collectSettledPiMessages(
  session: AgentSession,
  previousMessageCount: number,
) {
  await waitForPostRunSettlement(session)
  return session.agent.state.messages.slice(previousMessageCount)
}

function buildFailedRunResult(input: {
  readonly session: AgentSession
  readonly newMessages: readonly Message[]
  readonly aborted: boolean
  readonly message: string
}): AgentKernelRunResult {
  return {
    newMessages: input.newMessages,
    piSessionId: input.session.sessionId,
    piSessionFile: input.session.sessionFile,
    sessionSnapshot: projectPiSessionSnapshot(input.session),
    ...(input.aborted ? { aborted: true } : { terminalError: input.message }),
  }
}

function emitFailedRunEnd(input: {
  readonly runInput: AgentKernelRunInput
  readonly aborted: boolean
  readonly message: string
}) {
  input.runInput.onEvent({
    type: 'agent_end',
    runId: input.runInput.runId,
    reason: input.aborted ? 'aborted' : 'error',
    ...(input.aborted ? {} : { error: { message: input.message } }),
    timestamp: Date.now(),
    model: input.runInput.model,
  })
}

export function buildFailedSubscribedRunResult(input: {
  readonly session: AgentSession
  readonly runInput: AgentKernelRunInput
  readonly appended: readonly unknown[]
  readonly operationAborted: boolean
  readonly error: unknown
  readonly buildErrorMessages: (appended: readonly unknown[]) => readonly Message[]
}) {
  const stopReason = getPiAssistantStopReason(input.appended)
  const aborted = input.operationAborted || stopReason === 'aborted'
  const message = describePiRunError(input.error)

  emitFailedRunEnd({
    runInput: input.runInput,
    aborted,
    message,
  })

  return buildFailedRunResult({
    session: input.session,
    newMessages: input.buildErrorMessages(input.appended),
    aborted,
    message,
  })
}

export async function buildFailedRunAfterSettlement(input: {
  readonly session: AgentSession
  readonly runInput: AgentKernelRunInput
  readonly previousMessageCount: number
  readonly operationAborted: boolean
  readonly settlementAttempted: boolean
  readonly error: unknown
  readonly buildErrorMessages: (appended: readonly unknown[]) => readonly Message[]
}) {
  if (!input.settlementAttempted) {
    await waitForPostRunSettlement(input.session)
  }

  const appended = input.session.agent.state.messages.slice(input.previousMessageCount)
  return buildFailedSubscribedRunResult({
    session: input.session,
    runInput: input.runInput,
    appended,
    operationAborted: input.operationAborted,
    error: input.error,
    buildErrorMessages: input.buildErrorMessages,
  })
}
