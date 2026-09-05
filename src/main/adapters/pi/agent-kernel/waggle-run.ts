import { randomUUID } from 'node:crypto'
import type { AgentSession, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { createPiWaggleExtension } from '@openwaggle/pi-waggle/loop'
import { appendPiWaggleModeState, enabledPiWaggleModeState } from '@openwaggle/pi-waggle/mode-state'
import {
  createPiWaggleStopPolicyState,
  evaluatePiWaggleStopPolicy,
  summarizePiWaggleTurnMessages,
} from '@openwaggle/pi-waggle/stop-policy'
import { SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { WaggleStreamMetadata } from '@shared/types/waggle'
import type {
  AgentKernelRunInput,
  AgentKernelWaggleRunOptions,
} from '../../../ports/agent-kernel-service'
import type { PiModel } from '../pi-provider-catalog'
import { buildPiRunAssistantMessages } from '../pi-run-result'
import { logger } from './constants'
import { createPiRunSessionRuntime, runSubscribedPiOperation } from './run-lifecycle'
import type { PiRuntimeExtensionIsolationInput } from './runtime-extension-isolation'
import { createSessionListener } from './session-listener'
import { captureTurnCheckpoint } from './turn-capture'
import { resolveWaggleRuntimeConfig } from './waggle-model-resolution'
import {
  buildWaggleTurnCustomMessage,
  buildWaggleTurnMetadata,
  sendInitialWaggleMessages,
} from './waggle-run-messages'

type PiWaggleKernelRunInput = AgentKernelRunInput & {
  readonly waggle: AgentKernelWaggleRunOptions
  /**
   * The tree this turn runs in, already resolved (and born, for a worktree-mode session) by
   * the caller. Passed in rather than re-derived: worktree birth persists the new path with
   * SQL without mutating the `SessionDetail` it was given, so calling it twice would try to
   * create the same worktree again and fail.
   */
  readonly workingPath: string
  readonly visualizationDirectory?: string
  readonly mcpExtensionFactory?: ExtensionFactory
} & PiRuntimeExtensionIsolationInput

function appendEnabledWaggleModeState(input: {
  readonly session: AgentSession
  readonly runInput: PiWaggleKernelRunInput
}) {
  appendPiWaggleModeState(
    input.session.sessionManager,
    enabledPiWaggleModeState({ config: input.runInput.waggle.config }),
  )
}

function withTransportEventModel(
  event: AgentTransportEvent,
  meta: WaggleStreamMetadata,
): AgentTransportEvent {
  return { ...event, model: meta.agentModel }
}

function emitWaggleTurnStart(input: PiWaggleKernelRunInput, meta: WaggleStreamMetadata) {
  input.waggle.onTurnEvent({
    type: 'turn-start',
    turnNumber: meta.turnNumber,
    agentIndex: meta.agentIndex,
    agentLabel: meta.agentLabel,
  })
}

function emitWaggleTurnEnd(input: PiWaggleKernelRunInput, meta: WaggleStreamMetadata) {
  input.waggle.onTurnEvent({
    type: 'turn-end',
    turnNumber: meta.turnNumber,
    agentIndex: meta.agentIndex,
    agentLabel: meta.agentLabel,
    agentColor: meta.agentColor,
    agentModel: meta.agentModel,
  })
}

async function restoreInitialWaggleModel(input: {
  readonly session: AgentSession
  readonly model: PiModel
}) {
  await input.session.setModel(input.model).catch((error) => {
    logger.warn('Failed to restore initial Pi Waggle model', {
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

async function runInitialWaggleTurn(ctx: {
  readonly session: AgentSession
  readonly model: PiModel
  readonly input: PiWaggleKernelRunInput
  readonly meta: WaggleStreamMetadata
  readonly runtimeConfig: ReturnType<typeof resolveWaggleRuntimeConfig>
  readonly waggleDone: Promise<void>
}) {
  appendEnabledWaggleModeState({ session: ctx.session, runInput: ctx.input })
  emitWaggleTurnStart(ctx.input, ctx.meta)
  try {
    await sendInitialWaggleMessages({
      session: ctx.session,
      model: ctx.model,
      meta: ctx.meta,
      payload: ctx.input.payload,
      runId: ctx.input.runId,
      runtimeConfig: ctx.runtimeConfig,
    })
    await ctx.waggleDone
  } finally {
    await restoreInitialWaggleModel({ session: ctx.session, model: ctx.model })
  }
}

function createConfiguredWaggleExtension(input: {
  readonly runInput: PiWaggleKernelRunInput
  readonly runtimeConfig: ReturnType<typeof resolveWaggleRuntimeConfig>
  readonly waggleSessionId: string
  readonly onActiveTurnChange: (meta: WaggleStreamMetadata) => void
}) {
  let policyState = createPiWaggleStopPolicyState()
  return createPiWaggleExtension<WaggleStreamMetadata>({
    config: input.runtimeConfig,
    createTurnMetadata: ({ turnNumber }) =>
      buildWaggleTurnMetadata({
        config: input.runtimeConfig,
        turnNumber,
        waggleSessionId: input.waggleSessionId,
      }),
    onTurnComplete: ({ meta, messages, turn }) => {
      const summary = summarizePiWaggleTurnMessages(messages)
      const evaluation = evaluatePiWaggleStopPolicy({
        config: input.runtimeConfig,
        turnNumber: turn.turnNumber,
        summary,
        state: policyState,
        agentLabel: meta.agentLabel,
      })
      policyState = evaluation.state

      if (evaluation.turnSucceeded) emitWaggleTurnEnd(input.runInput, meta)
      if (evaluation.consensus) {
        input.runInput.waggle.onTurnEvent({
          type: 'consensus-reached',
          result: evaluation.consensus,
        })
      }
      if (!evaluation.continue) {
        const stopReason =
          evaluation.stop ??
          ({
            classification: 'complete',
            reason: `Reached maximum turns (${String(policyState.successfulTurnCount)})`,
          } as const)
        if (stopReason.classification === 'complete') {
          input.runInput.waggle.onTurnEvent({
            type: 'collaboration-complete',
            reason: stopReason.reason,
            totalTurns: policyState.successfulTurnCount,
          })
        } else {
          input.runInput.waggle.onTurnEvent({
            type: 'collaboration-stopped',
            reason: stopReason.reason,
          })
        }
      }
      return { continue: evaluation.continue }
    },
    onActiveTurnChange: input.onActiveTurnChange,
    onTurnStart: (meta) => emitWaggleTurnStart(input.runInput, meta),
    canStartNextTurn: () => !input.runInput.signal.aborted,
    buildTurnMessage: ({ model: turnModel, meta }) =>
      buildWaggleTurnCustomMessage({
        model: turnModel,
        payload: input.runInput.payload,
        config: input.runtimeConfig,
        meta,
        runId: input.runInput.runId,
      }),
  })
}

export async function runPiWaggle(input: PiWaggleKernelRunInput) {
  const projectPath = input.workingPath
  const waggleSessionId = randomUUID()
  const runtimeConfig = resolveWaggleRuntimeConfig({
    config: input.waggle.config,
    inheritedModel: input.waggle.inheritedModel,
  })
  const initialRuntimeModel = SupportedModelId(runtimeConfig.agents[0].model)
  let currentMeta = buildWaggleTurnMetadata({
    config: runtimeConfig,
    turnNumber: 0,
    waggleSessionId,
  })

  const waggleExtension = createConfiguredWaggleExtension({
    runInput: input,
    runtimeConfig,
    waggleSessionId,
    onActiveTurnChange: (meta) => {
      currentMeta = meta
    },
  })

  const { model, session } = await createPiRunSessionRuntime({
    session: input.session,
    projectPath,
    runId: input.runId,
    modelReference: initialRuntimeModel,
    compactionThresholdPercent: input.compactionThresholdPercent,
    payload: input.payload,
    signal: input.signal,
    onEvent: (event) =>
      input.waggle.onWaggleEvent(withTransportEventModel(event, currentMeta), currentMeta),
    ...(input.onControlAvailable ? { onControlAvailable: input.onControlAvailable } : {}),
    skillToggles: input.skillToggles,
    enabledOpenWaggleExtensionPackages: input.enabledOpenWaggleExtensionPackages,
    enabledOpenWaggleExtensionPackagePaths: input.enabledOpenWaggleExtensionPackagePaths,
    ...(input.visualizationDirectory
      ? { visualizationDirectory: input.visualizationDirectory }
      : {}),
    recordOpenWaggleExtensionRuntimeFailure: input.recordOpenWaggleExtensionRuntimeFailure,
    steeringInputHook: true,
    extensionFactories: [
      ...(input.mcpExtensionFactory ? [input.mcpExtensionFactory] : []),
      waggleExtension.factory,
    ],
  })

  const unsubscribe = session.subscribe(
    createSessionListener(
      {
        ...input,
        model: initialRuntimeModel,
        getContextWindow: (provider, modelId) => {
          const activeModel = session.model
          return activeModel?.provider === provider && activeModel.id === modelId
            ? activeModel.contextWindow
            : undefined
        },
        onEvent: (event) =>
          input.waggle.onWaggleEvent(withTransportEventModel(event, currentMeta), currentMeta),
      },
      input.runId,
    ),
  )
  const result = await runSubscribedPiOperation({
    runInput: input,
    session,
    unsubscribe,
    abortWarning: 'Failed to abort Pi Waggle turn cleanly',
    preAbortWarning: 'Failed to abort pre-cancelled Pi Waggle turn cleanly',
    operation: () =>
      runInitialWaggleTurn({
        session,
        model,
        input,
        meta: currentMeta,
        runtimeConfig,
        waggleDone: waggleExtension.done,
      }),
    buildErrorMessages: buildPiRunAssistantMessages,
  })
  await captureTurnCheckpoint({ session: input.session, projectPath, runId: input.runId })
  return result
}
