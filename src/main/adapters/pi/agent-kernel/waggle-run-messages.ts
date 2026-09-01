import type { AgentSession } from '@earendil-works/pi-coding-agent'
import {
  createPiWaggleTurnDetails,
  PI_WAGGLE_TURN_CUSTOM_TYPE,
  PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
} from '@openwaggle/pi-waggle/protocol'
import { buildWaggleTurnPrompt, getWaggleTurn } from '@openwaggle/waggle-core'
import type { HydratedAgentSendPayload } from '@shared/types/agent'
import { SupportedModelId } from '@shared/types/brand'
import type { WaggleConfig, WaggleStreamMetadata } from '@shared/types/waggle'
import type { PiModel } from '../pi-provider-catalog'
import { buildPiPromptInput, type PiPromptInput } from '../pi-runtime-input'
import type { PiCustomContent } from './message-parts'

function piPromptInputToCustomContent(input: PiPromptInput): PiCustomContent {
  const text = input.text
  if (input.images.length === 0) {
    return text
  }

  return text ? [{ type: 'text', text }, ...input.images] : [...input.images]
}

function buildWaggleTurnPayload(
  payload: HydratedAgentSendPayload,
  input: {
    readonly config: WaggleConfig
    readonly turnNumber: number
  },
): HydratedAgentSendPayload {
  return {
    ...payload,
    text: buildWaggleTurnPrompt({
      config: input.config,
      turnNumber: input.turnNumber,
      userPrompt: payload.text,
    }),
  }
}

export function buildWaggleTurnMetadata(input: {
  readonly config: WaggleConfig
  readonly turnNumber: number
  readonly waggleSessionId: string
}): WaggleStreamMetadata {
  const turn = getWaggleTurn(input.config, input.turnNumber)
  return {
    agentIndex: turn.agentIndex,
    agentLabel: turn.agent.label,
    agentColor: turn.agent.color,
    agentModel: SupportedModelId(turn.agent.model),
    turnNumber: input.turnNumber,
    collaborationMode: input.config.mode,
    sessionId: input.waggleSessionId,
  }
}

function buildTurnDetails(input: {
  readonly meta: WaggleStreamMetadata
  readonly fallbackRunId: string
  readonly visualizationContext?: string | null
}) {
  return {
    ...createPiWaggleTurnDetails({
      runId: input.meta.sessionId ?? input.fallbackRunId,
      turnNumber: input.meta.turnNumber,
      agentIndex: input.meta.agentIndex,
      agentLabel: input.meta.agentLabel,
      agentModel: input.meta.agentModel,
      agentColor: input.meta.agentColor,
    }),
    ...(input.visualizationContext
      ? { openWaggleVisualizationContext: input.visualizationContext }
      : {}),
  }
}

export async function sendInitialWaggleMessages(input: {
  readonly session: AgentSession
  readonly model: PiModel
  readonly meta: WaggleStreamMetadata
  readonly payload: HydratedAgentSendPayload
  readonly runId: string
  readonly runtimeConfig: WaggleConfig
}) {
  await input.session.sendCustomMessage(
    {
      customType: PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
      content: piPromptInputToCustomContent(buildPiPromptInput(input.model, input.payload)),
      display: true,
      details: {
        source: 'openwaggle',
        kind: 'waggle-user-request',
        ...(input.payload.waggle
          ? {
              waggleInvocation: {
                presetId: input.payload.waggle.presetId,
                presetName: input.payload.waggle.presetName,
                source: input.payload.waggle.source,
              },
            }
          : {}),
      },
    },
    { triggerTurn: false },
  )

  const initialTurnInput = buildPiPromptInput(
    input.model,
    buildWaggleTurnPayload(input.payload, {
      config: input.runtimeConfig,
      turnNumber: 0,
    }),
  )
  await input.session.sendCustomMessage(
    {
      customType: PI_WAGGLE_TURN_CUSTOM_TYPE,
      content: piPromptInputToCustomContent(initialTurnInput),
      display: false,
      details: buildTurnDetails({
        meta: input.meta,
        fallbackRunId: input.runId,
        visualizationContext: initialTurnInput.visualizationContext,
      }),
    },
    { triggerTurn: true },
  )
}

export function buildWaggleTurnCustomMessage(input: {
  readonly model: PiModel
  readonly payload: HydratedAgentSendPayload
  readonly config: WaggleConfig
  readonly meta: WaggleStreamMetadata
  readonly runId: string
}) {
  const turnPayload = buildWaggleTurnPayload(input.payload, {
    config: input.config,
    turnNumber: input.meta.turnNumber,
  })
  const turnInput = buildPiPromptInput(input.model, turnPayload)

  return {
    customType: PI_WAGGLE_TURN_CUSTOM_TYPE,
    content: piPromptInputToCustomContent(turnInput),
    display: false,
    details: {
      ...buildTurnDetails({
        meta: input.meta,
        fallbackRunId: input.runId,
        visualizationContext: turnInput.visualizationContext,
      }),
    },
  }
}
