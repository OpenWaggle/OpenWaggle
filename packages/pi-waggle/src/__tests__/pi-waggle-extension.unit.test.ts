import type { AgentEndEvent } from '@mariozechner/pi-coding-agent'
import type { WaggleConfig } from '@openwaggle/waggle-core'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import {
  type PiWaggleAgentEndHandler,
  type PiWaggleExtensionApi,
  type PiWaggleExtensionContext,
  type PiWaggleModel,
  type PiWaggleTurnMessageInput,
  registerPiWaggleLoop,
} from '../extension'

const FIRST_PROVIDER_CHARACTER_INDEX = 0
const MODEL_ID_START_OFFSET = 1
const FIRST_AGENT_INDEX = 0
const SECOND_AGENT_INDEX = 1
const SECOND_TURN_NUMBER = 1
const FIRST_COMPLETION_COUNT = 1
const SINGLE_TURN_LIMIT = 1
const MAX_TURNS_SAFETY = 4
const PRIMARY_MODEL = 'openai/gpt-5.5'
const SECONDARY_MODEL = 'anthropic/claude-sonnet-4'

interface TestMeta {
  readonly turnNumber: number
  readonly agentIndex: number
  readonly label: string
}

function config(maxTurnsSafety = MAX_TURNS_SAFETY): WaggleConfig {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: PRIMARY_MODEL,
        roleDescription: 'Designs the implementation',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: SECONDARY_MODEL,
        roleDescription: 'Reviews the implementation',
        color: 'amber',
      },
    ],
    stop: { primary: 'consensus', maxTurnsSafety },
  }
}

function metadata(waggleConfig: WaggleConfig, turnNumber: number, agentIndex: number): TestMeta {
  return {
    turnNumber,
    agentIndex,
    label: waggleConfig.agents[agentIndex].label,
  }
}

function modelFor(modelReference: string): PiWaggleModel {
  const separatorIndex = modelReference.indexOf('/')
  if (separatorIndex <= FIRST_PROVIDER_CHARACTER_INDEX) {
    throw new Error(`Expected provider/model id, received ${modelReference}`)
  }

  return fromPartial<PiWaggleModel>({
    provider: modelReference.slice(FIRST_PROVIDER_CHARACTER_INDEX, separatorIndex),
    id: modelReference.slice(separatorIndex + MODEL_ID_START_OFFSET),
  })
}

function agentEndEvent(messages: AgentEndEvent['messages'] = []): AgentEndEvent {
  return { type: 'agent_end', messages }
}

function createHarness(model = modelFor(SECONDARY_MODEL)) {
  let agentEndHandler: PiWaggleAgentEndHandler | null = null
  const sendMessage = vi.fn<PiWaggleExtensionApi['sendMessage']>()
  const setModel = vi.fn<PiWaggleExtensionApi['setModel']>(async () => true)
  const modelRegistry = {
    find: vi.fn((provider: string, modelId: string) =>
      provider === model.provider && modelId === model.id ? model : undefined,
    ),
  }
  const api: PiWaggleExtensionApi = {
    onAgentEnd: vi.fn((handler) => {
      agentEndHandler = handler
    }),
    sendMessage,
    setModel,
  }
  const ctx: PiWaggleExtensionContext = { modelRegistry }

  async function emitAgentEnd(messages?: AgentEndEvent['messages']) {
    const handler = agentEndHandler
    if (!handler) {
      throw new Error('Expected Pi Waggle loop to register an agent_end handler')
    }

    await handler(agentEndEvent(messages), ctx)
  }

  return { api, ctx, emitAgentEnd, modelRegistry, sendMessage, setModel }
}

function buildTurnMessage(input: PiWaggleTurnMessageInput<TestMeta>) {
  return {
    customType: 'pi-waggle.turn',
    content: `turn ${String(input.turn.turnNumber)}`,
    display: false,
    details: {
      turnNumber: input.turn.turnNumber,
      agentIndex: input.turn.agentIndex,
      agentLabel: input.meta.label,
    },
  }
}

describe('pi-waggle extension loop', () => {
  it('switches models and schedules the next hidden follow-up turn after the current run settles', async () => {
    vi.useFakeTimers()
    const waggleConfig = config()
    const harness = createHarness()
    const activeTurns: TestMeta[] = []
    const startedTurns: TestMeta[] = []
    const activeMetaAtMessageBuild: (TestMeta | undefined)[] = []
    const buildTurnMessageMock = vi.fn((input: PiWaggleTurnMessageInput<TestMeta>) => {
      activeMetaAtMessageBuild.push(activeTurns.at(FIRST_AGENT_INDEX))
      return buildTurnMessage(input)
    })

    registerPiWaggleLoop(
      {
        config: waggleConfig,
        createTurnMetadata: ({ turnNumber, agentIndex }) =>
          metadata(waggleConfig, turnNumber, agentIndex),
        onTurnComplete: () => ({ continue: true }),
        buildTurnMessage: buildTurnMessageMock,
        onActiveTurnChange: (meta) => activeTurns.push(meta),
        onTurnStart: (meta) => startedTurns.push(meta),
        onComplete: vi.fn(),
        onError: vi.fn(),
      },
      harness.api,
    )

    try {
      await harness.emitAgentEnd()

      expect(harness.modelRegistry.find).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4')
      expect(harness.setModel).toHaveBeenCalledWith(modelFor(SECONDARY_MODEL))
      expect(harness.sendMessage).not.toHaveBeenCalled()
      await vi.runOnlyPendingTimersAsync()
      expect(harness.sendMessage).toHaveBeenCalledWith(
        {
          customType: 'pi-waggle.turn',
          content: 'turn 1',
          display: false,
          details: {
            turnNumber: SECOND_TURN_NUMBER,
            agentIndex: SECOND_AGENT_INDEX,
            agentLabel: 'Reviewer',
          },
        },
        { triggerTurn: true },
      )
      expect(activeTurns).toEqual([
        { turnNumber: SECOND_TURN_NUMBER, agentIndex: SECOND_AGENT_INDEX, label: 'Reviewer' },
      ])
      expect(startedTurns).toEqual(activeTurns)
      expect(activeMetaAtMessageBuild).toEqual(activeTurns)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips a scheduled default next turn when the caller reports cancellation', async () => {
    vi.useFakeTimers()
    const waggleConfig = config()
    const harness = createHarness()
    let canStartNextTurn = true

    registerPiWaggleLoop(
      {
        config: waggleConfig,
        createTurnMetadata: ({ turnNumber, agentIndex }) =>
          metadata(waggleConfig, turnNumber, agentIndex),
        onTurnComplete: () => ({ continue: true }),
        buildTurnMessage,
        canStartNextTurn: () => canStartNextTurn,
        onComplete: vi.fn(),
        onError: vi.fn(),
      },
      harness.api,
    )

    try {
      await harness.emitAgentEnd()
      canStartNextTurn = false
      await vi.runOnlyPendingTimersAsync()

      expect(harness.sendMessage).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('can delegate next-turn scheduling to a caller-provided starter', async () => {
    const waggleConfig = config()
    const harness = createHarness()
    const startNextTurn = vi.fn()

    registerPiWaggleLoop(
      {
        config: waggleConfig,
        createTurnMetadata: ({ turnNumber, agentIndex }) =>
          metadata(waggleConfig, turnNumber, agentIndex),
        onTurnComplete: () => ({ continue: true }),
        buildTurnMessage,
        startNextTurn,
        onComplete: vi.fn(),
        onError: vi.fn(),
      },
      harness.api,
    )

    await harness.emitAgentEnd()

    expect(startNextTurn).toHaveBeenCalledWith({
      model: modelFor(SECONDARY_MODEL),
      turn: {
        turnNumber: SECOND_TURN_NUMBER,
        agentIndex: SECOND_AGENT_INDEX,
        agent: waggleConfig.agents[SECOND_AGENT_INDEX],
      },
      meta: { turnNumber: SECOND_TURN_NUMBER, agentIndex: SECOND_AGENT_INDEX, label: 'Reviewer' },
      message: expect.objectContaining({ customType: 'pi-waggle.turn' }),
    })
    expect(harness.sendMessage).not.toHaveBeenCalled()
  })

  it('resolves the loop without scheduling another turn when product policy stops', async () => {
    const waggleConfig = config()
    const harness = createHarness()
    const onComplete = vi.fn()
    const onTurnComplete = vi.fn(() => ({ continue: false }))

    registerPiWaggleLoop(
      {
        config: waggleConfig,
        createTurnMetadata: ({ turnNumber, agentIndex }) =>
          metadata(waggleConfig, turnNumber, agentIndex),
        onTurnComplete,
        buildTurnMessage,
        onComplete,
        onError: vi.fn(),
      },
      harness.api,
    )

    await harness.emitAgentEnd()
    await harness.emitAgentEnd()

    expect(onTurnComplete).toHaveBeenCalledTimes(FIRST_COMPLETION_COUNT)
    expect(onComplete).toHaveBeenCalledOnce()
    expect(harness.setModel).not.toHaveBeenCalled()
    expect(harness.sendMessage).not.toHaveBeenCalled()
  })

  it('resolves the loop without scheduling another turn at the max-turn safety limit', async () => {
    const waggleConfig = config(SINGLE_TURN_LIMIT)
    const harness = createHarness()
    const onComplete = vi.fn()

    registerPiWaggleLoop(
      {
        config: waggleConfig,
        createTurnMetadata: ({ turnNumber, agentIndex }) =>
          metadata(waggleConfig, turnNumber, agentIndex),
        onTurnComplete: () => ({ continue: true }),
        buildTurnMessage,
        onComplete,
        onError: vi.fn(),
      },
      harness.api,
    )

    await harness.emitAgentEnd()

    expect(onComplete).toHaveBeenCalledOnce()
    expect(harness.setModel).not.toHaveBeenCalled()
    expect(harness.sendMessage).not.toHaveBeenCalled()
  })

  it('rejects the loop when the next turn model is unavailable', async () => {
    const waggleConfig = config()
    const harness = createHarness(modelFor(PRIMARY_MODEL))
    const onError = vi.fn()

    registerPiWaggleLoop(
      {
        config: waggleConfig,
        createTurnMetadata: ({ turnNumber, agentIndex }) =>
          metadata(waggleConfig, turnNumber, agentIndex),
        onTurnComplete: () => ({ continue: true }),
        buildTurnMessage,
        onComplete: vi.fn(),
        onError,
      },
      harness.api,
    )

    await harness.emitAgentEnd()

    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect(harness.setModel).not.toHaveBeenCalled()
    expect(harness.sendMessage).not.toHaveBeenCalled()
  })
})
