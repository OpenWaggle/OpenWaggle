import { randomUUID } from 'node:crypto'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
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
import { createSessionListener } from './session-listener'
import { resolveSessionProjectPath } from './session-manager'
import { resolveWaggleRuntimeConfig } from './waggle-model-resolution'
import {
  buildWaggleTurnCustomMessage,
  buildWaggleTurnMetadata,
  sendInitialWaggleMessages,
} from './waggle-run-messages'

type PiWaggleKernelRunInput = AgentKernelRunInput & {
  readonly waggle: AgentKernelWaggleRunOptions
}

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

export async function runPiWaggle(input: PiWaggleKernelRunInput) {
  const projectPath = resolveSessionProjectPath(input.session)
  const waggleSessionId = randomUUID()
  const runtimeConfig = resolveWaggleRuntimeConfig({
    config: input.waggle.config,
    inheritedModel: input.waggle.inheritedModel,
  })
  const initialRuntimeModel = SupportedModelId(runtimeConfig.agents[0].model)
  let policyState = createPiWaggleStopPolicyState()
  let currentMeta = buildWaggleTurnMetadata({
    config: runtimeConfig,
    turnNumber: 0,
    waggleSessionId,
  })

  const waggleExtension = createPiWaggleExtension<WaggleStreamMetadata>({
    config: runtimeConfig,
    createTurnMetadata: ({ turnNumber }) =>
      buildWaggleTurnMetadata({ config: runtimeConfig, turnNumber, waggleSessionId }),
    onTurnComplete: ({ meta, messages, turn }) => {
      const summary = summarizePiWaggleTurnMessages(messages)
      const evaluation = evaluatePiWaggleStopPolicy({
        config: runtimeConfig,
        turnNumber: turn.turnNumber,
        summary,
        state: policyState,
        agentLabel: meta.agentLabel,
      })
      policyState = evaluation.state

      if (evaluation.turnSucceeded) {
        emitWaggleTurnEnd(input, meta)
      }

      if (evaluation.consensus) {
        input.waggle.onTurnEvent({ type: 'consensus-reached', result: evaluation.consensus })
      }

      if (!evaluation.continue) {
        const stopReason =
          evaluation.stop ??
          ({
            classification: 'complete',
            reason: `Reached maximum turns (${String(policyState.successfulTurnCount)})`,
          } as const)

        if (stopReason.classification === 'complete') {
          input.waggle.onTurnEvent({
            type: 'collaboration-complete',
            reason: stopReason.reason,
            totalTurns: policyState.successfulTurnCount,
          })
        } else {
          input.waggle.onTurnEvent({ type: 'collaboration-stopped', reason: stopReason.reason })
        }
      }

      return { continue: evaluation.continue }
    },
    onActiveTurnChange: (meta) => {
      currentMeta = meta
    },
    onTurnStart: (meta) => emitWaggleTurnStart(input, meta),
    canStartNextTurn: () => !input.signal.aborted,
    buildTurnMessage: ({ model: turnModel, meta }) =>
      buildWaggleTurnCustomMessage({
        model: turnModel,
        payload: input.payload,
        config: runtimeConfig,
        meta,
        runId: input.runId,
      }),
  })

  const { model, session } = await createPiRunSessionRuntime({
    session: input.session,
    projectPath,
    modelReference: initialRuntimeModel,
    payload: input.payload,
    skillToggles: input.skillToggles,
    extensionFactories: [waggleExtension.factory],
  })

  const unsubscribe = session.subscribe(
    createSessionListener(
      {
        ...input,
        model: initialRuntimeModel,
        onEvent: (event) =>
          input.waggle.onWaggleEvent(withTransportEventModel(event, currentMeta), currentMeta),
      },
      input.runId,
    ),
  )

  return runSubscribedPiOperation({
    runInput: input,
    session,
    unsubscribe,
    abortWarning: 'Failed to abort Pi Waggle turn cleanly',
    preAbortWarning: 'Failed to abort pre-cancelled Pi Waggle turn cleanly',
    operation: async () => {
      appendEnabledWaggleModeState({ session, runInput: input })
      emitWaggleTurnStart(input, currentMeta)
      try {
        await sendInitialWaggleMessages({
          session,
          model,
          meta: currentMeta,
          payload: input.payload,
          runId: input.runId,
          runtimeConfig,
        })
        await waggleExtension.done
      } finally {
        await restoreInitialWaggleModel({ session, model })
      }
    },
    buildErrorMessages: buildPiRunAssistantMessages,
  })
}
