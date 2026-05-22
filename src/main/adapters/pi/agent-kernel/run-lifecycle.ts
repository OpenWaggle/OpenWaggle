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
import { createSessionManagerForSession } from './session-manager'
import { projectPiSessionSnapshot } from './session-projection'

const POST_RUN_SETTLE_POLL_MS = 25
const POST_RUN_SETTLE_QUIET_MS = 150
const POST_RUN_SETTLE_MAX_MS = 15_000

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
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function hasQueuedMessages(session: AgentSession) {
  const agent = session.agent as { hasQueuedMessages?: () => boolean }
  return typeof agent.hasQueuedMessages === 'function' ? agent.hasQueuedMessages() : false
}

async function waitForIdle(session: AgentSession) {
  const agent = session.agent as { waitForIdle?: () => Promise<void> }
  if (typeof agent.waitForIdle === 'function') {
    await agent.waitForIdle()
  }
}

function digestMessage(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function buildSessionPostRunFingerprint(session: AgentSession) {
  const messages = session.agent.state.messages
  const lastMessage = messages.at(-1)
  return [
    messages.length,
    digestMessage(lastMessage),
    session.isCompacting ? 'compacting' : 'idle',
    session.isStreaming ? 'streaming' : 'ready',
    hasQueuedMessages(session) ? 'queued' : 'drained',
  ].join('|')
}

async function waitForPostRunSettlement(session: AgentSession, signal: AbortSignal) {
  const startedAt = Date.now()
  let lastChangedAt = startedAt
  let lastFingerprint = buildSessionPostRunFingerprint(session)

  while (Date.now() - startedAt < POST_RUN_SETTLE_MAX_MS) {
    await waitForIdle(session)
    if (signal.aborted) {
      return
    }

    const fingerprint = buildSessionPostRunFingerprint(session)
    const hasPendingWork = session.isCompacting || session.isStreaming || hasQueuedMessages(session)
    const changed = fingerprint !== lastFingerprint

    if (changed || hasPendingWork) {
      lastFingerprint = fingerprint
      lastChangedAt = Date.now()
      await wait(POST_RUN_SETTLE_POLL_MS)
      continue
    }

    if (Date.now() - lastChangedAt >= POST_RUN_SETTLE_QUIET_MS) {
      return
    }

    await wait(POST_RUN_SETTLE_POLL_MS)
  }

  logger.warn('Timed out waiting for Pi post-run settlement before snapshot capture', {
    maxWaitMs: POST_RUN_SETTLE_MAX_MS,
    isCompacting: session.isCompacting,
    isStreaming: session.isStreaming,
    queuedMessages: hasQueuedMessages(session),
  })
}

function buildSuccessfulRunResult(input: {
  readonly session: AgentSession
  readonly payload: HydratedAgentSendPayload
  readonly appended: readonly unknown[]
  readonly signal: AbortSignal
}): AgentKernelRunResult {
  const terminalError = extractPiAssistantTerminalError(input.appended)
  const stopReason = getPiAssistantStopReason(input.appended)

  return {
    newMessages: buildPiRunNewMessages(input.payload, input.appended),
    piSessionId: input.session.sessionId,
    piSessionFile: input.session.sessionFile,
    sessionSnapshot: projectPiSessionSnapshot(input.session),
    ...(stopReason === 'aborted' || input.signal.aborted ? { aborted: true } : {}),
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

  if (input.runInput.signal.aborted) {
    const result = await abortPreCancelledRun(input.session, input.preAbortWarning)
    input.unsubscribe()
    await disposeOpenWagglePiSession(input.session)
    return result
  }

  input.runInput.signal.addEventListener('abort', abortListener, { once: true })

  try {
    previousMessageCount = input.session.agent.state.messages.length
    await input.operation()
    await waitForPostRunSettlement(input.session, input.runInput.signal)
    const appended = input.session.agent.state.messages.slice(previousMessageCount)
    return buildSuccessfulRunResult({
      session: input.session,
      payload: input.runInput.payload,
      appended,
      signal: input.runInput.signal,
    })
  } catch (error) {
    await waitForPostRunSettlement(input.session, input.runInput.signal)
    const appended = input.session.agent.state.messages.slice(previousMessageCount)
    const stopReason = getPiAssistantStopReason(appended)
    const aborted = input.runInput.signal.aborted || stopReason === 'aborted'
    const message = error instanceof Error ? error.message : String(error)
    input.runInput.onEvent({
      type: 'agent_end',
      runId: input.runInput.runId,
      reason: aborted ? 'aborted' : 'error',
      ...(aborted ? {} : { error: { message } }),
      timestamp: Date.now(),
      model: input.runInput.model,
    })
    return buildFailedRunResult({
      session: input.session,
      newMessages: input.buildErrorMessages(appended),
      aborted,
      message,
    })
  } finally {
    input.runInput.signal.removeEventListener('abort', abortListener)
    input.unsubscribe()
    await disposeOpenWagglePiSession(input.session)
  }
}
