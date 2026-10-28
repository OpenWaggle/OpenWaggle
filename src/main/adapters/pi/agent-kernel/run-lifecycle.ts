import type {
  AgentSession,
  ExtensionFactory,
  InlineExtension,
} from '@earendil-works/pi-coding-agent'
import type { HydratedAgentSendPayload, Message } from '@shared/types/agent'
import type { ThinkingLevel } from '@shared/types/settings'
import { clampThinkingLevel } from '@shared/utils/thinking-levels'
import { resolveEffectiveAuthorizationMode } from '../../../application/agent-authorization-mode'
import type { AgentKernelRunInput, AgentKernelRunResult } from '../../../ports/agent-kernel-service'
import type { PiProjectionBase } from '../../../store/session-details/pi-projection-base'
import { getPiModelAvailableThinkingLevels, type PiModel } from '../pi-provider-catalog'
import { scratchDirectorySystemPrompt } from '../pi-provider-resources'
import {
  buildPiRunNewMessages,
  extractPiAssistantTerminalError,
  getPiAssistantStopReason,
} from '../pi-run-result'
import { disposeOpenWagglePiSession } from '../pi-session-lifecycle'
import {
  notePiRunProjectDefaultForUsageStatistics,
  withUsageStatisticsAccessMode,
} from '../pi-usage-statistics'
import { installIdleCompaction } from './idle-compaction-install'
import { notifyModelFallback, type PiInteractionUiContextInput } from './interaction-ui-context'
import { type PiEntryNodeIds, piEntryNodeIds } from './pi-entry-node-ids'
import { idleCacheWarming } from './pi-idle-cache-warming'
import {
  abortPreCancelledRun,
  createAbortListener,
  runPiOperationWithinAbortGrace,
} from './pi-run-abort'
import { createPiRunControl } from './pi-run-control'
import { createPiSessionForRun } from './pi-run-session'
import {
  buildFailedRunAfterSettlement,
  buildFailedSubscribedRunResult,
  capturePiMessageBoundary,
  collectPiMessagesAfterBoundary,
  collectSettledPiMessages,
} from './run-lifecycle-failure'
import { readRunProjectionBase } from './run-projection-base'
import {
  createIsolatedPiProjectRuntime,
  createPiProjectModelRuntimeWithoutOpenWaggleExtensions,
  type PiProjectRuntimeIsolationOptions,
  type PiRuntimeExtensionIsolationInput,
} from './runtime-extension-isolation'
import { createSessionManagerForSession, requireSessionProjectPath } from './session-manager'
import { sessionFallbackModelReference } from './session-model-fallback'
import { projectPiSessionSnapshot } from './session-projection'

export { promptPiSession } from './run-prompt'

export interface PiRunSessionRuntime {
  readonly model: PiModel
  readonly session: AgentSession
}

interface CreatePiRunSessionRuntimeInput extends PiRuntimeExtensionIsolationInput {
  readonly preparedEnvironment?: AgentKernelRunInput['preparedEnvironment']
  readonly session: AgentKernelRunInput['session']
  readonly projectPath: string
  readonly runId: AgentKernelRunInput['runId']
  readonly payload: HydratedAgentSendPayload
  readonly modelReference: AgentKernelRunInput['model']
  /** Continue on the last answering model if the selection is gone (never for a Waggle agent). */
  readonly modelFallback?: 'last-answering-model'
  readonly runAuthorizationOverride?: AgentKernelRunInput['runAuthorizationOverride']
  readonly authorityCallerId?: AgentKernelRunInput['authorityCallerId']
  readonly compactionThresholdPercent: AgentKernelRunInput['compactionThresholdPercent']
  readonly signal: AgentKernelRunInput['signal']
  readonly onEvent: AgentKernelRunInput['onEvent']
  readonly onControlAvailable?: AgentKernelRunInput['onControlAvailable']
  readonly skillToggles?: Readonly<Record<string, boolean>>
  readonly skillAllowlist?: readonly string[]
  readonly extensionFactories?: readonly InlineExtension[]
  readonly trustedExtensionFactories?: readonly ExtensionFactory[]
  readonly systemPromptAppendices?: readonly string[]
  readonly visualizationDirectory?: string
  readonly scratchDirectory?: string
  readonly steeringInputHook?: boolean
}

/** Scratch guidance, then the caller's; the first-turn prefix budget measures this too. */
export function runSystemPromptAppendices(
  input: Pick<CreatePiRunSessionRuntimeInput, 'scratchDirectory' | 'systemPromptAppendices'>,
  describeScratchDirectory: (scratchDirectory: string) => string = scratchDirectorySystemPrompt,
) {
  const appendices = [
    ...(input.scratchDirectory ? [describeScratchDirectory(input.scratchDirectory)] : []),
    ...(input.systemPromptAppendices ?? []),
  ]
  return appendices.length > 0 ? { systemPromptAppendices: appendices } : {}
}

function exposePiRunControl(
  input: CreatePiRunSessionRuntimeInput,
  runtime: { readonly model: PiModel; readonly modelFallbackMessage?: string },
  session: AgentSession,
  openWaggleUi: PiInteractionUiContextInput,
) {
  notifyModelFallback(openWaggleUi, input, runtime.modelFallbackMessage)
  input.onControlAvailable?.(
    createPiRunControl(session, input.signal, {
      routeThroughInputHook: input.steeringInputHook === true,
    }),
  )
  return { model: runtime.model, session }
}

/** A Run starts with the Session thinking level, clamped to the model the Run uses. */
function resolvePiRuntimeThinkingLevel(
  model: PiModel,
  sessionThinkingLevel: ThinkingLevel | undefined,
) {
  return sessionThinkingLevel
    ? clampThinkingLevel(sessionThinkingLevel, getPiModelAvailableThinkingLevels(model))
    : undefined
}

export async function createPiRunSessionRuntime(
  input: CreatePiRunSessionRuntimeInput,
): Promise<PiRunSessionRuntime> {
  // Before the Pi file opens; with the mode this Run's runtime resolves, Pi's settings included.
  await idleCacheWarming.prepareRun(input.session.id)
  // Not awaited: Usage statistics never delay a Run. Authorization state belongs to the
  // repository, so this is the Session's project, not the run cwd.
  void notePiRunProjectDefaultForUsageStatistics(input.runId, input.session.projectPath)
  const runtimeOptions = {
    projectPath: input.projectPath,
    modelReference: input.modelReference,
    ...(input.modelFallback ? sessionFallbackModelReference(input.session) : {}),
    compactionThresholdPercent: input.compactionThresholdPercent,
    ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
    ...(input.skillAllowlist ? { skillAllowlist: input.skillAllowlist } : {}),
    ...(input.extensionFactories ? { extensionFactories: [...input.extensionFactories] } : {}),
    ...(input.trustedExtensionFactories
      ? { trustedExtensionFactories: [...input.trustedExtensionFactories] }
      : {}),
    ...runSystemPromptAppendices(input),
    ...(input.visualizationDirectory
      ? { visualizationDirectory: input.visualizationDirectory }
      : {}),
  } satisfies PiProjectRuntimeIsolationOptions
  const selectedRuntime = await createIsolatedPiProjectRuntime({
    operation: 'Pi run session initialization',
    extensionIsolation: input,
    options: runtimeOptions,
  })
  const sessionManager = createSessionManagerForSession(input.session, input.projectPath)
  const openWaggleUi = {
    sessionId: input.session.id,
    runId: input.runId,
    // Deliberately the session's project, not `input.projectPath`: the latter is the run cwd, which
    // for a worktree session is the worktree. Authorization state belongs to the repository.
    authorizationProjectPath: input.session.projectPath,
    resolveAuthorizationMode: withUsageStatisticsAccessMode(input.runId, () =>
      resolveEffectiveAuthorizationMode(
        input.session.id,
        input.runAuthorizationOverride,
        input.authorityCallerId,
      ),
    ),
    signal: input.signal,
    onEvent: input.onEvent,
  }

  try {
    const thinkingLevel = resolvePiRuntimeThinkingLevel(
      selectedRuntime.runtime.model,
      input.session.executionThinkingLevel,
    )
    const { session } = await createPiSessionForRun({
      projectRoot: requireSessionProjectPath(input.session),
      workspacePath: input.projectPath,
      services: selectedRuntime.runtime.services,
      model: selectedRuntime.runtime.model,
      sessionManager,
      ...(thinkingLevel ? { thinkingLevel } : {}),
      openWaggleUi,
      ...(input.preparedEnvironment ? { preparedEnvironment: input.preparedEnvironment } : {}),
      ...(input.scratchDirectory ? { scratchDirectory: input.scratchDirectory } : {}),
    })
    installIdleCompaction(input.session.id, session)

    return exposePiRunControl(input, selectedRuntime.runtime, session, openWaggleUi)
  } catch (error) {
    if (selectedRuntime.enabledOpenWaggleExtensionPackagePaths.length === 0) {
      throw error
    }

    const fallbackRuntime =
      await createPiProjectModelRuntimeWithoutOpenWaggleExtensions(runtimeOptions)
    const thinkingLevel = resolvePiRuntimeThinkingLevel(
      fallbackRuntime.model,
      input.session.executionThinkingLevel,
    )
    const { session } = await createPiSessionForRun({
      projectRoot: requireSessionProjectPath(input.session),
      workspacePath: input.projectPath,
      services: fallbackRuntime.services,
      model: fallbackRuntime.model,
      sessionManager,
      ...(thinkingLevel ? { thinkingLevel } : {}),
      openWaggleUi,
      ...(input.preparedEnvironment ? { preparedEnvironment: input.preparedEnvironment } : {}),
      ...(input.scratchDirectory ? { scratchDirectory: input.scratchDirectory } : {}),
    })

    return exposePiRunControl(input, fallbackRuntime, session, openWaggleUi)
  }
}

function buildSuccessfulRunResult(input: {
  readonly session: AgentSession
  readonly nodeIds: PiEntryNodeIds
  readonly projectionBase: PiProjectionBase | null
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
    sessionSnapshot: projectPiSessionSnapshot(input.session, input.nodeIds, input.projectionBase),
    ...(stopReason === 'aborted' || input.aborted ? { aborted: true } : {}),
    ...(terminalError ? { terminalError } : {}),
  }
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
  let operationAborted = false
  let settlementAttempted = false

  if (input.runInput.signal.aborted) {
    const result = await abortPreCancelledRun(
      input.session,
      piEntryNodeIds(input.runInput.session),
      input.preAbortWarning,
    )
    input.unsubscribe()
    await disposeOpenWagglePiSession(input.session)
    return result
  }

  const messageBoundary = capturePiMessageBoundary(input.session)
  input.runInput.signal.addEventListener('abort', abortListener, { once: true })

  try {
    const operationOutcome = await runPiOperationWithinAbortGrace({
      operation: input.operation,
      signal: input.runInput.signal,
      session: input.session,
    })

    operationAborted = input.runInput.signal.aborted
    input.runInput.signal.removeEventListener('abort', abortListener)

    settlementAttempted = true
    // An abandoned operation is still in Pi's post-loop work, so Pi would not settle in time.
    const appended =
      operationOutcome.status === 'abandoned'
        ? collectPiMessagesAfterBoundary(input.session, messageBoundary)
        : await collectSettledPiMessages(input.session, messageBoundary)

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
      nodeIds: piEntryNodeIds(input.runInput.session),
      projectionBase: await readRunProjectionBase(
        input.runInput.session,
        input.session.sessionFile,
      ),
      payload: input.runInput.payload,
      appended,
      aborted: operationAborted,
    })
  } catch (error) {
    return buildFailedRunAfterSettlement({
      session: input.session,
      runInput: input.runInput,
      messageBoundary,
      operationAborted,
      settlementAttempted,
      error,
      buildErrorMessages: input.buildErrorMessages,
    })
  } finally {
    input.runInput.signal.removeEventListener('abort', abortListener)
    input.unsubscribe()
    await idleCacheWarming.settle(input.runInput.session.id, input.session, {
      aborted: input.runInput.signal.aborted,
    })
  }
}
