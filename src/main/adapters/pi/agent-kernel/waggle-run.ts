import type {
  AgentSession,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
} from '@mariozechner/pi-coding-agent'
import { getMessageText, type HydratedAgentSendPayload, isToolCallPart } from '@shared/types/agent'
import type { AgentTransportEvent } from '@shared/types/stream'
import type {
  AgentKernelWaggleRunInput,
  AgentKernelWaggleTurnCompletion,
} from '../../../ports/agent-kernel-service'
import type { PiModel } from '../pi-provider-catalog'
import { buildPiRunAssistantMessages, extractPiAssistantTerminalError } from '../pi-run-result'
import { buildPiPromptInput, type PiPromptInput } from '../pi-runtime-input'
import { WAGGLE_TURN_CUSTOM_TYPE, WAGGLE_VISIBLE_USER_CUSTOM_TYPE } from './constants'
import { createDeferred, type Deferred } from './deferred'
import type { PiCustomContent } from './message-parts'
import { createPiRunSessionRuntime, runSubscribedPiOperation } from './run-lifecycle'
import { createSessionListener } from './session-listener'
import { resolveSessionProjectPath } from './session-manager'

function piPromptInputToCustomContent(input: PiPromptInput): PiCustomContent {
  if (input.images.length === 0) {
    return input.text
  }

  return input.text ? [{ type: 'text', text: input.text }, ...input.images] : [...input.images]
}

function buildWaggleTurnPayload(
  payload: HydratedAgentSendPayload,
  input: {
    readonly config: AgentKernelWaggleRunInput['config']
    readonly agentIndex: number
    readonly turnNumber: number
  },
): HydratedAgentSendPayload {
  const agent = input.config.agents[input.agentIndex]
  const otherAgent = input.config.agents[input.agentIndex === 0 ? 1 : 0]
  const lines = [
    `You are "${agent.label}". ${agent.roleDescription}`,
    '',
    `You are collaborating with "${otherAgent.label}" (${otherAgent.roleDescription}).`,
    `This is turn ${String(input.turnNumber + 1)} of the collaboration.`,
    '',
    'Guidelines:',
    '- Use tools to inspect real files and project state before making claims.',
    '- Build on previous contributions rather than repeating them.',
    '- If you agree with the other agent, say so explicitly and briefly.',
    '- If you disagree, explain your reasoning with references to actual code.',
    '- Focus on adding new value each turn.',
    '- End your turn with a concise, direct summary of your findings and position.',
  ]

  if (input.turnNumber > 0) {
    lines.push(
      '',
      'Review the session above and continue the collaboration.',
      'If the other agent made claims about the code, verify them by reading relevant files.',
      'Focus on your role and perspective.',
    )
  }

  return {
    ...payload,
    text: `${lines.join('\n')}\n\n---\n\nUser request:\n${payload.text}`,
    attachments: [],
  }
}

async function sendInitialWaggleMessages(input: {
  readonly session: AgentSession
  readonly model: PiModel
  readonly runInput: AgentKernelWaggleRunInput
}) {
  await input.session.sendCustomMessage(
    {
      customType: WAGGLE_VISIBLE_USER_CUSTOM_TYPE,
      content: piPromptInputToCustomContent(
        buildPiPromptInput(input.model, input.runInput.payload),
      ),
      display: true,
      details: { source: 'openwaggle', kind: 'waggle-user-request' },
    },
    { triggerTurn: false },
  )

  await input.session.sendCustomMessage(
    {
      customType: WAGGLE_TURN_CUSTOM_TYPE,
      content: piPromptInputToCustomContent(
        buildPiPromptInput(
          input.model,
          buildWaggleTurnPayload(input.runInput.payload, {
            config: input.runInput.config,
            agentIndex: 0,
            turnNumber: 0,
          }),
        ),
      ),
      display: false,
      details: { source: 'openwaggle', kind: 'waggle-turn', turnNumber: 0, agentIndex: 0 },
    },
    { triggerTurn: true },
  )
}
function buildWaggleTurnCompletion(
  meta: AgentKernelWaggleTurnCompletion['meta'],
  messages: readonly unknown[],
): AgentKernelWaggleTurnCompletion {
  const assistantMessages = buildPiRunAssistantMessages(messages)
  const responseText = assistantMessages.map(getMessageText).join('\n\n')
  const hasToolCalls = assistantMessages.some((message) => message.parts.some(isToolCallPart))
  const terminalError = extractPiAssistantTerminalError(messages)

  return {
    meta,
    assistantMessages,
    responseText,
    hasToolCalls,
    ...(terminalError ? { terminalError } : {}),
  }
}

function withTransportEventModel(
  event: AgentTransportEvent,
  meta: AgentKernelWaggleTurnCompletion['meta'],
): AgentTransportEvent {
  return { ...event, model: meta.agentModel }
}

function getWaggleTurnAgentIndex(config: AgentKernelWaggleRunInput['config'], turnNumber: number) {
  return turnNumber % config.agents.length
}

function emitWaggleTurnStart(
  input: AgentKernelWaggleRunInput,
  meta: AgentKernelWaggleTurnCompletion['meta'],
) {
  input.onTurnEvent({
    type: 'turn-start',
    turnNumber: meta.turnNumber,
    agentIndex: meta.agentIndex,
    agentLabel: meta.agentLabel,
  })
}

function createModelRefFromSupportedModelId(modelReference: string) {
  const separatorIndex = modelReference.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex === modelReference.length - 1) {
    throw new Error(`Expected provider/model id, received ${modelReference}`)
  }
  return {
    provider: modelReference.slice(0, separatorIndex),
    id: modelReference.slice(separatorIndex + 1),
  }
}

async function sendWaggleTurnMessage(input: {
  readonly pi: ExtensionAPI
  readonly ctx: Pick<ExtensionContext, 'modelRegistry'>
  readonly payload: HydratedAgentSendPayload
  readonly config: AgentKernelWaggleRunInput['config']
  readonly turnNumber: number
}) {
  const agentIndex = getWaggleTurnAgentIndex(input.config, input.turnNumber)
  const agent = input.config.agents[agentIndex]
  const modelReference = createModelRefFromSupportedModelId(agent.model)
  const model = input.ctx.modelRegistry.find(modelReference.provider, modelReference.id)
  if (!model) {
    throw new Error(`Pi model registry could not resolve model ${String(agent.model)}`)
  }

  const modelChanged = await input.pi.setModel(model)
  if (!modelChanged) {
    throw new Error(`Pi model ${String(agent.model)} is not available for Waggle mode`)
  }

  const turnPayload = buildWaggleTurnPayload(input.payload, {
    config: input.config,
    agentIndex,
    turnNumber: input.turnNumber,
  })
  input.pi.sendMessage(
    {
      customType: WAGGLE_TURN_CUSTOM_TYPE,
      content: piPromptInputToCustomContent(buildPiPromptInput(model, turnPayload)),
      display: false,
      details: {
        source: 'openwaggle',
        kind: 'waggle-turn',
        turnNumber: input.turnNumber,
        agentIndex,
      },
    },
    { triggerTurn: true, deliverAs: 'followUp' },
  )
}

function createWaggleExtension(input: {
  readonly runInput: AgentKernelWaggleRunInput
  readonly payload: HydratedAgentSendPayload
  readonly loopDone: Deferred
  readonly updateMeta: (meta: AgentKernelWaggleTurnCompletion['meta']) => void
}): ExtensionFactory {
  return (pi) => {
    let turnNumber = 0
    let stopped = false

    pi.on('agent_end', async (event, ctx) => {
      if (stopped) {
        return
      }

      try {
        const agentIndex = getWaggleTurnAgentIndex(input.runInput.config, turnNumber)
        const meta = input.runInput.createTurnMetadata({ turnNumber, agentIndex })
        const decision = await input.runInput.onTurnComplete(
          buildWaggleTurnCompletion(meta, event.messages),
        )
        const nextTurnNumber = turnNumber + 1
        if (!decision.continue || nextTurnNumber >= input.runInput.config.stop.maxTurnsSafety) {
          stopped = true
          input.loopDone.resolve()
          return
        }

        turnNumber = nextTurnNumber
        const nextAgentIndex = getWaggleTurnAgentIndex(input.runInput.config, turnNumber)
        const nextMeta = input.runInput.createTurnMetadata({
          turnNumber,
          agentIndex: nextAgentIndex,
        })
        input.updateMeta(nextMeta)
        emitWaggleTurnStart(input.runInput, nextMeta)
        await sendWaggleTurnMessage({
          pi,
          ctx,
          payload: input.payload,
          config: input.runInput.config,
          turnNumber,
        })
      } catch (error) {
        stopped = true
        input.loopDone.reject(error)
      }
    })
  }
}
export async function runPiWaggle(input: AgentKernelWaggleRunInput) {
  const projectPath = resolveSessionProjectPath(input.session)
  const loopDone = createDeferred()
  let currentMeta = input.createTurnMetadata({ turnNumber: 0, agentIndex: 0 })
  const { model, session } = await createPiRunSessionRuntime({
    session: input.session,
    projectPath,
    modelReference: input.config.agents[0]?.model ?? input.model,
    payload: input.payload,
    skillToggles: input.skillToggles,
    extensionFactories: [
      createWaggleExtension({
        runInput: input,
        payload: input.payload,
        loopDone,
        updateMeta: (meta) => {
          currentMeta = meta
        },
      }),
    ],
  })

  const unsubscribe = session.subscribe(
    createSessionListener(
      {
        ...input,
        model: input.config.agents[0].model,
        onEvent: (event) =>
          input.onWaggleEvent(withTransportEventModel(event, currentMeta), currentMeta),
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
      emitWaggleTurnStart(input, currentMeta)
      await sendInitialWaggleMessages({ session, model, runInput: input })
      await loopDone.promise
    },
    buildErrorMessages: buildPiRunAssistantMessages,
  })
}
