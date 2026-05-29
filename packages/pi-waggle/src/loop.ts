import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  TurnEndEvent,
} from '@mariozechner/pi-coding-agent'
import type { WaggleConfig, WaggleTurn } from '@openwaggle/waggle-core'
import { decideNextWaggleTurn, getWaggleTurn } from '@openwaggle/waggle-core'

const INITIAL_TURN_NUMBER = 0
const FIRST_PROVIDER_CHARACTER_INDEX = 0
const MODEL_ID_START_OFFSET = 1

export type PiWaggleModel = NonNullable<ReturnType<ExtensionContext['modelRegistry']['find']>>
export type PiWaggleCustomMessage = Parameters<ExtensionAPI['sendMessage']>[0]
export type PiWaggleSendMessageOptions = NonNullable<Parameters<ExtensionAPI['sendMessage']>[1]>

const NEXT_TURN_MESSAGE_OPTIONS = {
  triggerTurn: true,
} satisfies PiWaggleSendMessageOptions
const NEXT_TURN_DISPATCH_DELAY_MS = 0

export interface PiWaggleTurnMetadataInput {
  readonly turnNumber: number
  readonly agentIndex: number
}

export interface PiWaggleTurnCompleteInput<TMeta> {
  readonly turn: WaggleTurn
  readonly meta: TMeta
  readonly messages: AgentEndEvent['messages']
}

export interface PiWaggleTurnDecision {
  readonly continue: boolean
}

export interface PiWaggleTurnMessageInput<TMeta> {
  readonly model: PiWaggleModel
  readonly turn: WaggleTurn
  readonly meta: TMeta
}

export interface PiWaggleStartNextTurnInput<TMeta> extends PiWaggleTurnMessageInput<TMeta> {
  readonly message: PiWaggleCustomMessage
}

export interface PiWaggleResolveTurnModelInput<TMeta> {
  readonly ctx: PiWaggleExtensionContext
  readonly turn: WaggleTurn
  readonly meta: TMeta
}

export interface PiWaggleExtensionInput<TMeta> {
  readonly config: WaggleConfig
  readonly createTurnMetadata: (input: PiWaggleTurnMetadataInput) => TMeta
  readonly onTurnComplete: (
    input: PiWaggleTurnCompleteInput<TMeta>,
  ) => PiWaggleTurnDecision | Promise<PiWaggleTurnDecision>
  readonly buildTurnMessage: (input: PiWaggleTurnMessageInput<TMeta>) => PiWaggleCustomMessage
  readonly resolveTurnModel?: (
    input: PiWaggleResolveTurnModelInput<TMeta>,
  ) => PiWaggleModel | Promise<PiWaggleModel>
  readonly startNextTurn?: (input: PiWaggleStartNextTurnInput<TMeta>) => void | Promise<void>
  readonly canStartNextTurn?: () => boolean
  readonly onActiveTurnChange?: (meta: TMeta) => void
  readonly onTurnStart?: (meta: TMeta) => void
}

export interface PiWaggleLoopInput<TMeta> extends PiWaggleExtensionInput<TMeta> {
  readonly onComplete: () => void
  readonly onError: (error: unknown) => void
}

export type PiWaggleAgentEndHandler = (
  event: AgentEndEvent,
  ctx: PiWaggleExtensionContext,
) => Promise<void> | void

export type PiWaggleTurnEndHandler = (
  event: TurnEndEvent,
  ctx: PiWaggleExtensionContext,
) => Promise<void> | void

export interface PiWaggleExtensionContext {
  readonly modelRegistry: Pick<ExtensionContext['modelRegistry'], 'find'>
}

export interface PiWaggleLoopApi {
  readonly sendMessage: ExtensionAPI['sendMessage']
  readonly setModel: ExtensionAPI['setModel']
}

export interface PiWaggleExtensionApi extends PiWaggleLoopApi {
  readonly onAgentEnd: (handler: PiWaggleAgentEndHandler) => void
}

export interface PiWaggleExtensionController {
  readonly factory: ExtensionFactory
  readonly done: Promise<void>
}

function createDeferred() {
  let resolveDeferred: (() => void) | undefined
  let rejectDeferred: ((error: unknown) => void) | undefined
  const promise = new Promise<void>((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })

  if (!resolveDeferred || !rejectDeferred) {
    throw new Error('Failed to create Pi Waggle completion promise')
  }

  return { promise, resolve: resolveDeferred, reject: rejectDeferred }
}

function createModelRefFromProviderQualifiedId(modelReference: string) {
  const separatorIndex = modelReference.indexOf('/')
  if (
    separatorIndex <= FIRST_PROVIDER_CHARACTER_INDEX ||
    separatorIndex === modelReference.length - MODEL_ID_START_OFFSET
  ) {
    throw new Error(`Expected provider/model id, received ${modelReference}`)
  }

  return {
    provider: modelReference.slice(FIRST_PROVIDER_CHARACTER_INDEX, separatorIndex),
    id: modelReference.slice(separatorIndex + MODEL_ID_START_OFFSET),
  }
}

function resolveTurnModel(input: {
  readonly ctx: PiWaggleExtensionContext
  readonly turn: WaggleTurn
}) {
  const modelReference = createModelRefFromProviderQualifiedId(input.turn.agent.model)
  const model = input.ctx.modelRegistry.find(modelReference.provider, modelReference.id)
  if (!model) {
    throw new Error(`Pi model registry could not resolve model ${input.turn.agent.model}`)
  }

  return model
}

function turnEndMessages(event: TurnEndEvent): AgentEndEvent['messages'] {
  return [event.message, ...event.toolResults]
}

function assistantMessageHasToolCalls(message: AgentEndEvent['messages'][number]) {
  return message.role === 'assistant' && message.content.some((part) => part.type === 'toolCall')
}

function scheduleDefaultNextTurn<TMeta>(input: {
  readonly api: PiWaggleLoopApi
  readonly loop: PiWaggleLoopInput<TMeta>
  readonly message: PiWaggleCustomMessage
}) {
  setTimeout(() => {
    if (input.loop.canStartNextTurn && !input.loop.canStartNextTurn()) {
      return
    }

    try {
      input.api.sendMessage(input.message, NEXT_TURN_MESSAGE_OPTIONS)
    } catch (error) {
      input.loop.onError(error)
    }
  }, NEXT_TURN_DISPATCH_DELAY_MS)
}

async function sendNextTurn<TMeta>(input: {
  readonly api: PiWaggleLoopApi
  readonly ctx: PiWaggleExtensionContext
  readonly loop: PiWaggleLoopInput<TMeta>
  readonly turn: WaggleTurn
  readonly meta: TMeta
}) {
  const model = input.loop.resolveTurnModel
    ? await input.loop.resolveTurnModel({ ctx: input.ctx, turn: input.turn, meta: input.meta })
    : resolveTurnModel({ ctx: input.ctx, turn: input.turn })
  const modelChanged = await input.api.setModel(model)
  if (!modelChanged) {
    throw new Error(`Pi model ${input.turn.agent.model} is not available for Waggle mode`)
  }

  const message = input.loop.buildTurnMessage({ model, turn: input.turn, meta: input.meta })
  if (input.loop.startNextTurn) {
    await input.loop.startNextTurn({ model, turn: input.turn, meta: input.meta, message })
    return
  }

  scheduleDefaultNextTurn({ api: input.api, loop: input.loop, message })
}

export function createPiWaggleLoopHandler<TMeta>(
  input: PiWaggleLoopInput<TMeta>,
  api: PiWaggleLoopApi,
): PiWaggleAgentEndHandler {
  let turnNumber = INITIAL_TURN_NUMBER
  let stopped = false

  return async (event, ctx) => {
    if (stopped) {
      return
    }

    try {
      const turn = getWaggleTurn(input.config, turnNumber)
      const meta = input.createTurnMetadata({
        turnNumber: turn.turnNumber,
        agentIndex: turn.agentIndex,
      })
      const decision = await input.onTurnComplete({ turn, meta, messages: event.messages })
      const nextTurnDecision = decideNextWaggleTurn(input.config, { turnNumber })
      if (!decision.continue || !nextTurnDecision.continue || !nextTurnDecision.nextTurn) {
        stopped = true
        input.onComplete()
        return
      }

      turnNumber = nextTurnDecision.nextTurn.turnNumber
      const nextMeta = input.createTurnMetadata({
        turnNumber,
        agentIndex: nextTurnDecision.nextTurn.agentIndex,
      })
      input.onActiveTurnChange?.(nextMeta)
      input.onTurnStart?.(nextMeta)
      await sendNextTurn({
        api,
        ctx,
        loop: input,
        turn: nextTurnDecision.nextTurn,
        meta: nextMeta,
      })
    } catch (error) {
      stopped = true
      input.onError(error)
    }
  }
}

export interface PiWaggleTurnCompletionHandlers {
  readonly onTurnEnd: PiWaggleTurnEndHandler
  readonly onAgentEnd: PiWaggleAgentEndHandler
}

export function createPiWaggleTurnCompletionHandlers<TMeta>(
  input: PiWaggleLoopInput<TMeta>,
  api: PiWaggleLoopApi,
): PiWaggleTurnCompletionHandlers {
  const onTurnComplete = createPiWaggleLoopHandler(input, api)
  const pendingMessages: AgentEndEvent['messages'] = []

  return {
    onTurnEnd: (event, ctx) => {
      pendingMessages.push(...turnEndMessages(event))

      if (assistantMessageHasToolCalls(event.message)) {
        return undefined
      }

      const messages = [...pendingMessages]
      pendingMessages.length = 0
      return onTurnComplete({ type: 'agent_end', messages }, ctx)
    },
    onAgentEnd: (event, ctx) => {
      if (pendingMessages.length === 0) {
        return undefined
      }

      const messages = [...pendingMessages]
      pendingMessages.length = 0
      return onTurnComplete({ ...event, messages }, ctx)
    },
  }
}

export function createPiWaggleTurnEndHandler<TMeta>(
  input: PiWaggleLoopInput<TMeta>,
  api: PiWaggleLoopApi,
): PiWaggleTurnEndHandler {
  return createPiWaggleTurnCompletionHandlers(input, api).onTurnEnd
}

export function registerPiWaggleLoop<TMeta>(
  input: PiWaggleLoopInput<TMeta>,
  api: PiWaggleExtensionApi,
) {
  api.onAgentEnd(createPiWaggleLoopHandler(input, api))
}

export function createPiWaggleExtension<TMeta>(
  input: PiWaggleExtensionInput<TMeta>,
): PiWaggleExtensionController {
  const completion = createDeferred()

  return {
    done: completion.promise,
    factory: (pi) => {
      registerPiWaggleLoop(
        {
          ...input,
          onComplete: completion.resolve,
          onError: completion.reject,
        },
        {
          onAgentEnd: (handler) => pi.on('agent_end', handler),
          sendMessage: (message, options) => pi.sendMessage(message, options),
          setModel: (model) => pi.setModel(model),
        },
      )
    },
  }
}
