import { randomUUID } from 'node:crypto'
import type { ExtensionAPI, ExtensionContext, InputEvent } from '@earendil-works/pi-coding-agent'
import type { WaggleConfig, WaggleTurn } from '@openwaggle/waggle-core'
import { buildWaggleTurnPrompt, getWaggleTurn } from '@openwaggle/waggle-core'
import type { StartDefaultPiWaggleRun } from './default-command-types.js'
import {
  type DefaultPiWaggleModel,
  effectiveAgentModelReference,
  modelReferenceForModel,
  resolveTurnModel,
  setTurnModel,
} from './default-run-model.js'
import {
  clearRunStatus,
  notify,
  setWaggleStatus,
  updateRunningStatus,
} from './default-run-status.js'
import { piWaggleTurnErrorClassifier } from './default-turn-error.js'
import {
  createPiWaggleLoopHandler,
  type PiWaggleAgentEndHandler,
  type PiWaggleCustomMessage,
} from './loop.js'
import {
  createPiWaggleTurnDetails,
  PI_WAGGLE_TURN_CUSTOM_TYPE,
  PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
} from './protocol.js'
import {
  createPiWaggleStopPolicyState,
  evaluatePiWaggleStopPolicy,
  type PiWaggleStopPolicyState,
  summarizePiWaggleTurnMessages,
} from './stop-policy.js'

const INITIAL_TURN_NUMBER = 0
const NEXT_TURN_DISPLAY_OFFSET = 1
const PI_DISPATCH_TICK_DELAY_MS = 0

export { clearRunStatus, setWaggleStatus }

type PiInputImage = NonNullable<InputEvent['images']>[number]

interface DefaultPiWaggleTurnMeta {
  readonly turnNumber: number
  readonly agentIndex: number
}

export interface DefaultPiWaggleRunState {
  readonly config: WaggleConfig
  readonly inheritedModel: DefaultPiWaggleModel
  readonly inheritedModelReference: string
  readonly policyState: PiWaggleStopPolicyState
  readonly runId: string
  readonly turnNumber: number
  readonly userPrompt: string
  readonly userImages: readonly PiInputImage[]
  /** Judges the turn and starts the next one, with the messages of a settled Pi run. */
  readonly onAgentEnd: PiWaggleAgentEndHandler
  /** Ends the Waggle when the user aborts its turn (Escape). */
  readonly onAborted: () => Promise<void>
}

export function buildDefaultTurnMessage(
  run: Pick<DefaultPiWaggleRunState, 'config' | 'inheritedModelReference' | 'runId' | 'userPrompt'>,
  turn: WaggleTurn,
  resolvedModelReference = effectiveAgentModelReference(
    turn.agent.model,
    run.inheritedModelReference,
  ),
) {
  return {
    customType: PI_WAGGLE_TURN_CUSTOM_TYPE,
    content: buildWaggleTurnPrompt({
      config: run.config,
      turnNumber: turn.turnNumber,
      userPrompt: run.userPrompt,
    }),
    display: true,
    details: createPiWaggleTurnDetails({
      runId: run.runId,
      turnNumber: turn.turnNumber,
      agentIndex: turn.agentIndex,
      agentLabel: turn.agent.label,
      agentModel: resolvedModelReference,
      agentColor: turn.agent.color,
    }),
  }
}

function continuationPrompt(turn: WaggleTurn) {
  return `Continue Waggle turn ${String(turn.turnNumber + NEXT_TURN_DISPLAY_OFFSET)} as ${turn.agent.label}.`
}

function buildUserMessageContent(prompt: string, images: readonly PiInputImage[]) {
  if (images.length === 0) {
    return prompt
  }

  return [{ type: 'text' as const, text: prompt }, ...images]
}

async function waitForPiDispatch() {
  await new Promise((resolve) => setTimeout(resolve, PI_DISPATCH_TICK_DELAY_MS))
}

function scheduleNextTurnDispatch(input: {
  readonly pi: Pick<ExtensionAPI, 'sendMessage' | 'sendUserMessage'>
  readonly ctx: ExtensionContext
  readonly getActiveRun: () => DefaultPiWaggleRunState | null
  readonly setActiveRun: (run: DefaultPiWaggleRunState | null) => void
  readonly message: PiWaggleCustomMessage
  readonly runId: string
  readonly turn: WaggleTurn
}) {
  setTimeout(() => {
    const activeRun = input.getActiveRun()
    if (
      !activeRun ||
      activeRun.runId !== input.runId ||
      activeRun.turnNumber !== input.turn.turnNumber
    ) {
      return
    }

    try {
      input.pi.sendMessage(input.message, { triggerTurn: false })
      // Pi 1.2 counts a starting run as busy; a run started meanwhile takes it as a follow-up.
      input.pi.sendUserMessage(continuationPrompt(input.turn), { deliverAs: 'followUp' })
    } catch (error) {
      clearRunStatus(input.ctx, input.setActiveRun)
      notify(input.ctx, error instanceof Error ? error.message : String(error), 'error')
    }
  }, PI_DISPATCH_TICK_DELAY_MS)
}

function buildDefaultWaggleRunHandler(input: {
  readonly pi: Pick<ExtensionAPI, 'sendMessage' | 'sendUserMessage' | 'setModel'>
  readonly ctx: ExtensionContext
  readonly config: WaggleConfig
  readonly getActiveRun: () => DefaultPiWaggleRunState | null
  readonly setActiveRun: (run: DefaultPiWaggleRunState | null) => void
}) {
  return createPiWaggleLoopHandler<DefaultPiWaggleTurnMeta>(
    {
      config: input.config,
      createTurnMetadata: ({ turnNumber, agentIndex }) => ({ turnNumber, agentIndex }),
      onTurnComplete: async ({ turn, messages }) => {
        const activeRun = input.getActiveRun()
        if (!activeRun) return { continue: false }

        const isRecoverableError = await piWaggleTurnErrorClassifier()
        const evaluation = evaluatePiWaggleStopPolicy({
          config: activeRun.config,
          turnNumber: activeRun.turnNumber,
          summary: summarizePiWaggleTurnMessages(
            messages,
            isRecoverableError ? { isRecoverableError } : {},
          ),
          state: activeRun.policyState,
          agentLabel: turn.agent.label,
        })

        if (!evaluation.continue) {
          await input.pi.setModel(activeRun.inheritedModel)
          input.setActiveRun(null)
          if (evaluation.stop?.classification === 'stopped') {
            setWaggleStatus(input.ctx, undefined)
            notify(input.ctx, evaluation.stop.reason, 'warning')
          } else {
            setWaggleStatus(input.ctx, 'Waggle complete')
          }
          if (input.ctx.hasUI) input.ctx.ui.setWorkingMessage()
          return { continue: false }
        }

        input.setActiveRun({ ...activeRun, policyState: evaluation.state })
        return { continue: true }
      },
      resolveTurnModel: ({ turn }) => {
        const activeRun = input.getActiveRun()
        if (!activeRun) throw new Error('Active Waggle run is missing')
        return resolveTurnModel({
          ctx: input.ctx,
          turn,
          inheritedModelReference: activeRun.inheritedModelReference,
        })
      },
      buildTurnMessage: ({ turn, model }) => {
        const activeRun = input.getActiveRun()
        if (!activeRun) throw new Error('Active Waggle run is missing')
        return buildDefaultTurnMessage(activeRun, turn, modelReferenceForModel(model))
      },
      startNextTurn: ({ message, turn }) => {
        const activeRun = input.getActiveRun()
        if (!activeRun) throw new Error('Active Waggle run is missing')
        scheduleNextTurnDispatch({
          pi: input.pi,
          ctx: input.ctx,
          getActiveRun: input.getActiveRun,
          setActiveRun: input.setActiveRun,
          message,
          runId: activeRun.runId,
          turn,
        })
      },
      onActiveTurnChange: (meta) => {
        const activeRun = input.getActiveRun()
        if (activeRun) input.setActiveRun({ ...activeRun, turnNumber: meta.turnNumber })
      },
      onTurnStart: (meta) => {
        const activeRun = input.getActiveRun()
        if (!activeRun) return
        const turn = getWaggleTurn(input.config, meta.turnNumber)
        updateRunningStatus(
          input.ctx,
          turn,
          effectiveAgentModelReference(turn.agent.model, activeRun.inheritedModelReference),
        )
      },
      onComplete: () => undefined,
      onError: (error) => {
        clearRunStatus(input.ctx, input.setActiveRun)
        notify(input.ctx, error instanceof Error ? error.message : String(error), 'error')
      },
    },
    {
      sendMessage: (message, options) => input.pi.sendMessage(message, options),
      setModel: (model) => input.pi.setModel(model),
    },
  )
}

export function createStartDefaultWaggleRun(input: {
  readonly getActiveRun: () => DefaultPiWaggleRunState | null
  readonly setActiveRun: (run: DefaultPiWaggleRunState | null) => void
}): StartDefaultPiWaggleRun {
  return async ({ pi, ctx, config, prompt, images, dispatchPrompt = true }) => {
    if (!ctx.model) {
      throw new Error('Select a Pi model before starting Waggle mode.')
    }

    const inheritedModel = ctx.model
    const inheritedModelReference = modelReferenceForModel(inheritedModel)
    const firstTurn = getWaggleTurn(config, INITIAL_TURN_NUMBER)
    const userImages = [...(images ?? [])]
    const firstModel = await setTurnModel({
      pi,
      ctx,
      turn: firstTurn,
      inheritedModelReference,
    })

    const onAgentEnd = buildDefaultWaggleRunHandler({
      pi,
      ctx,
      config,
      getActiveRun: input.getActiveRun,
      setActiveRun: input.setActiveRun,
    })
    const run = {
      config,
      inheritedModel,
      inheritedModelReference,
      policyState: createPiWaggleStopPolicyState(),
      runId: randomUUID(),
      turnNumber: INITIAL_TURN_NUMBER,
      userPrompt: prompt,
      userImages,
      onAgentEnd,
      onAborted: async () => {
        if (input.getActiveRun()?.runId !== run.runId) return
        await pi.setModel(inheritedModel)
        clearRunStatus(ctx, input.setActiveRun)
        notify(ctx, 'Waggle stopped because the turn was aborted.', 'warning')
      },
    } satisfies DefaultPiWaggleRunState

    input.setActiveRun(run)
    updateRunningStatus(ctx, firstTurn, modelReferenceForModel(firstModel))
    try {
      pi.sendMessage(
        {
          customType: PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
          content: prompt,
          display: true,
          details: { kind: 'waggle-user-request' },
        },
        { triggerTurn: false },
      )
      pi.sendMessage(buildDefaultTurnMessage(run, firstTurn, modelReferenceForModel(firstModel)), {
        triggerTurn: false,
      })
      if (dispatchPrompt) {
        pi.sendUserMessage(buildUserMessageContent(prompt, userImages), { deliverAs: 'followUp' })
        await waitForPiDispatch()
      }
    } catch (error) {
      clearRunStatus(ctx, input.setActiveRun)
      throw error
    }
  }
}
