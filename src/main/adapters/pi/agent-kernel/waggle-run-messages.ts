import type { AgentSession } from '@mariozechner/pi-coding-agent'
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
  if (input.images.length === 0) {
    return input.text
  }

  return input.text ? [{ type: 'text', text: input.text }, ...input.images] : [...input.images]
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
}) {
  return createPiWaggleTurnDetails({
    runId: input.meta.sessionId ?? input.fallbackRunId,
    turnNumber: input.meta.turnNumber,
    agentIndex: input.meta.agentIndex,
    agentLabel: input.meta.agentLabel,
    agentModel: input.meta.agentModel,
    agentColor: input.meta.agentColor,
  })
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
      details: { source: 'openwaggle', kind: 'waggle-user-request' },
    },
    { triggerTurn: false },
  )

  await input.session.sendCustomMessage(
    {
      customType: PI_WAGGLE_TURN_CUSTOM_TYPE,
      content: piPromptInputToCustomContent(
        buildPiPromptInput(
          input.model,
          buildWaggleTurnPayload(input.payload, {
            config: input.runtimeConfig,
            turnNumber: 0,
          }),
        ),
      ),
      display: false,
      details: buildTurnDetails({ meta: input.meta, fallbackRunId: input.runId }),
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

  return {
    customType: PI_WAGGLE_TURN_CUSTOM_TYPE,
    content: piPromptInputToCustomContent(buildPiPromptInput(input.model, turnPayload)),
    display: false,
    details: {
      ...buildTurnDetails({ meta: input.meta, fallbackRunId: input.runId }),
    },
  }
}
