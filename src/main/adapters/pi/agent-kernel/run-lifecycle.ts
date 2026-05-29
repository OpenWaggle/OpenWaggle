import type {
  AgentSession,
  AgentSessionServices,
  ExtensionFactory,
  SessionManager,
} from '@mariozechner/pi-coding-agent'
import type { HydratedAgentSendPayload, Message } from '@shared/types/agent'
import type { ThinkingLevel } from '@shared/types/settings'
import { clampThinkingLevel } from '@shared/utils/thinking-levels'
import type { AgentKernelRunInput, AgentKernelRunResult } from '../../../ports/agent-kernel-service'
import {
  createPiProjectModelRuntime,
  getPiModelAvailableThinkingLevels,
  type PiModel,
} from '../pi-provider-catalog'
import {
  buildPiRunNewMessages,
  extractPiAssistantTerminalError,
  getPiAssistantStopReason,
} from '../pi-run-result'
import { buildPiPromptInput } from '../pi-runtime-input'
import {
  createOpenWaggleAgentSessionFromServices,
  disposeOpenWagglePiSession,
} from '../pi-session-lifecycle'
import { logger } from './constants'
import { waitForPostRunSettlement } from './post-run-settlement'
import { createSessionManagerForSession } from './session-manager'
import { projectPiSessionSnapshot } from './session-projection'

export interface PiRunSessionRuntime {
  readonly model: PiModel
  readonly session: AgentSession
}

function resolvePiRuntimeThinkingLevel(model: PiModel, requestedThinkingLevel: ThinkingLevel) {
  return clampThinkingLevel(requestedThinkingLevel, getPiModelAvailableThinkingLevels(model))
}

async function createPiSessionForRun(input: {
  readonly services: AgentSessionServices
  readonly model: PiModel
  readonly sessionManager: SessionManager
  readonly thinkingLevel: ThinkingLevel
}) {
  const hasExistingMessages = input.sessionManager.buildSessionContext().messages.length > 0
  const result = hasExistingMessages
    ? await createOpenWaggleAgentSessionFromServices({
        services: input.services,
        model: input.model,
        sessionManager: input.sessionManager,
      })
    : await createOpenWaggleAgentSessionFromServices({
        services: input.services,
        model: input.model,
        thinkingLevel: input.thinkingLevel,
        sessionManager: input.sessionManager,
      })

  if (hasExistingMessages) {
    result.session.setThinkingLevel(input.thinkingLevel)
  }

  return result
}

export async function createPiRunSessionRuntime(input: {
  readonly session: AgentKernelRunInput['session']
  readonly projectPath: string
  readonly payload: HydratedAgentSendPayload
  readonly modelReference: AgentKernelRunInput['model']
  readonly skillToggles?: Readonly<Record<string, boolean>>
  readonly extensionFactories?: readonly ExtensionFactory[]
}): Promise<PiRunSessionRuntime> {
  const { model, services } = await createPiProjectModelRuntime({
    projectPath: input.projectPath,
    modelReference: input.modelReference,
    ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
    ...(input.extensionFactories ? { extensionFactories: [...input.extensionFactories] } : {}),
  })
  const sessionManager = createSessionManagerForSession(input.session, input.projectPath)
  const thinkingLevel = resolvePiRuntimeThinkingLevel(model, input.payload.thinkingLevel)
  const { session } = await createPiSessionForRun({
    services,
    model,
    sessionManager,
    thinkingLevel,
  })

  return { model, session }
}

function createAbortListener(session: AgentSession, warning: string) {
  return () => {
    void abortPiSession(session, warning)
  }
}

async function abortPiSession(session: AgentSession, warning: string) {
  await session.abort().catch((error) => {
    logger.warn(warning, {
      error: describeError(error),
    })
  })
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function buildSuccessfulRunResult(input: {
  readonly session: AgentSession
  readonly payload: HydratedAgentSendPayload
  readonly appended: readonly unknown[]
  readonly aborted: boolean
}): AgentKernelRunResult {
  const terminalError = extractPiAssistantTerminalError(input.appended)
  const stopReason = getPiAssistantStopReason(input.appended)

  return {
    newMessages: buildPiRunNewMessages(input.payload, input.appended),
    piSessionId: input.session.sessionId,
    piSessionFile: input.session.sessionFile,
    sessionSnapshot: projectPiSessionSnapshot(input.session),
    ...(stopReason === 'aborted' || input.aborted ? { aborted: true } : {}),
    ...(terminalError ? { terminalError } : {}),
  }
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

type PiOperationOutcome =
  | {
      readonly status: 'completed'
    }
  | {
      readonly status: 'failed'
      readonly error: unknown
    }

async function runPiOperation(operation: () => Promise<void>): Promise<PiOperationOutcome> {
  try {
    await operation()
    return { status: 'completed' }
  } catch (error) {
    return { status: 'failed', error }
  }
}

async function collectSettledPiMessages(session: AgentSession, previousMessageCount: number) {
  await waitForPostRunSettlement(session)
  return session.agent.state.messages.slice(previousMessageCount)
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

function buildFailedSubscribedRunResult(input: {
  readonly session: AgentSession
  readonly runInput: AgentKernelRunInput
  readonly appended: readonly unknown[]
  readonly operationAborted: boolean
  readonly error: unknown
  readonly buildErrorMessages: (appended: readonly unknown[]) => readonly Message[]
}) {
  const stopReason = getPiAssistantStopReason(input.appended)
  const aborted = input.operationAborted || stopReason === 'aborted'
  const message = describeError(input.error)

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

async function buildFailedRunAfterSettlement(input: {
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

async function abortPreCancelledRun(session: AgentSession, warning: string) {
  await abortPiSession(session, warning)
  return {
    newMessages: [],
    piSessionId: session.sessionId,
    piSessionFile: session.sessionFile,
    sessionSnapshot: projectPiSessionSnapshot(session),
    aborted: true,
  } satisfies AgentKernelRunResult
}

export async function promptPiSession(
  session: AgentSession,
  model: PiModel,
  payload: HydratedAgentSendPayload,
) {
  const promptInput = buildPiPromptInput(model, payload)
  await session.prompt(
    promptInput.text,
    promptInput.images.length > 0 ? { images: [...promptInput.images] } : undefined,
  )
}

export async function runSubscribedPiOperation(input: {
  readonly runInput: AgentKernelRunInput
  readonly session: AgentSession
  readonly unsubscribe: () => void
  readonly abortWarning: string
  readonly preAbortWarning: string
  readonly operation: () => Promise<void>
  readonly buildErrorMessages: (appended: readonly unknown[]) => readonly Message[]
}) {
  const abortListener = createAbortListener(input.session, input.abortWarning)
  let previousMessageCount = input.session.agent.state.messages.length
  let abortListenerAttached = false
  let operationAborted = false
  let settlementAttempted = false

  if (input.runInput.signal.aborted) {
    const result = await abortPreCancelledRun(input.session, input.preAbortWarning)
    input.unsubscribe()
    await disposeOpenWagglePiSession(input.session)
    return result
  }

  input.runInput.signal.addEventListener('abort', abortListener, { once: true })
  abortListenerAttached = true

  try {
    previousMessageCount = input.session.agent.state.messages.length
    const operationOutcome = await runPiOperation(input.operation)

    operationAborted = input.runInput.signal.aborted
    input.runInput.signal.removeEventListener('abort', abortListener)
    abortListenerAttached = false

    settlementAttempted = true
    const appended = await collectSettledPiMessages(input.session, previousMessageCount)

    if (operationOutcome.status === 'failed') {
      return buildFailedSubscribedRunResult({
        session: input.session,
        runInput: input.runInput,
        appended,
        operationAborted,
        error: operationOutcome.error,
        buildErrorMessages: input.buildErrorMessages,
      })
    }

    return buildSuccessfulRunResult({
      session: input.session,
      payload: input.runInput.payload,
      appended,
      aborted: operationAborted,
    })
  } catch (error) {
    return buildFailedRunAfterSettlement({
      session: input.session,
      runInput: input.runInput,
      previousMessageCount,
      operationAborted,
      settlementAttempted,
      error,
      buildErrorMessages: input.buildErrorMessages,
    })
  } finally {
    if (abortListenerAttached) {
      input.runInput.signal.removeEventListener('abort', abortListener)
    }
    input.unsubscribe()
    await disposeOpenWagglePiSession(input.session)
  }
}
