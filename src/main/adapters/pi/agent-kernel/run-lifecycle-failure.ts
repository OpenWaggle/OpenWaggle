import { type AgentSession, sessionEntryToContextMessages } from '@earendil-works/pi-coding-agent'
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

export interface PiMessageBoundary {
  readonly entryIds: ReadonlySet<string>
  readonly messageCount: number
}

export function capturePiMessageBoundary(session: AgentSession): PiMessageBoundary {
  return {
    entryIds: new Set(session.sessionManager.getBranch().map((entry) => entry.id)),
    messageCount: session.agent.state.messages.length,
  }
}

function collectPiMessagesAfterBoundary(session: AgentSession, boundary: PiMessageBoundary) {
  const branch = session.sessionManager.getBranch()
  if (branch.length === 0 && boundary.entryIds.size === 0) {
    return session.agent.state.messages.slice(boundary.messageCount)
  }
  return branch
    .filter((entry) => !boundary.entryIds.has(entry.id))
    .flatMap(sessionEntryToContextMessages)
}

export async function collectSettledPiMessages(session: AgentSession, boundary: PiMessageBoundary) {
  await waitForPostRunSettlement(session)
  return collectPiMessagesAfterBoundary(session, boundary)
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
  readonly messageBoundary: PiMessageBoundary
  readonly operationAborted: boolean
  readonly settlementAttempted: boolean
  readonly error: unknown
  readonly buildErrorMessages: (appended: readonly unknown[]) => readonly Message[]
}) {
  if (!input.settlementAttempted) {
    await waitForPostRunSettlement(input.session)
  }

  const appended = collectPiMessagesAfterBoundary(input.session, input.messageBoundary)
  return buildFailedSubscribedRunResult({
    session: input.session,
    runInput: input.runInput,
    appended,
    operationAborted: input.operationAborted,
    error: input.error,
    buildErrorMessages: input.buildErrorMessages,
  })
}
