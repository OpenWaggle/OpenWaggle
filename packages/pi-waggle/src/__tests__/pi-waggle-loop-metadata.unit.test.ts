import type { AgentEndEvent } from '@mariozechner/pi-coding-agent'
import type { WaggleConfig } from '@openwaggle/waggle-core'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import {
  type PiWaggleAgentEndHandler,
  type PiWaggleExtensionApi,
  type PiWaggleExtensionContext,
  type PiWaggleModel,
  registerPiWaggleLoop,
} from '../extension'

const FIRST_PROVIDER_CHARACTER_INDEX = 0
const MODEL_ID_START_OFFSET = 1
const FIRST_AGENT_INDEX = 0
const FIRST_TURN_NUMBER = 0
const MAX_TURNS_SAFETY = 4
const PRIMARY_MODEL = 'openai/gpt-5.5'
const SECONDARY_MODEL = 'anthropic/claude-sonnet-4'

interface TestMeta {
  readonly turnNumber: number
  readonly agentIndex: number
  readonly label: string
}

function config(): WaggleConfig {
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
    stop: { primary: 'consensus', maxTurnsSafety: MAX_TURNS_SAFETY },
  }
}

function metadata(waggleConfig: WaggleConfig, turnNumber: number, agentIndex: number): TestMeta {
  return { turnNumber, agentIndex, label: waggleConfig.agents[agentIndex].label }
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
  const api: PiWaggleExtensionApi = {
    onAgentEnd: vi.fn((handler) => {
      agentEndHandler = handler
    }),
    sendMessage: vi.fn(),
    setModel: vi.fn(async () => true),
  }
  const ctx: PiWaggleExtensionContext = {
    modelRegistry: {
      find: vi.fn((provider: string, modelId: string) =>
        provider === model.provider && modelId === model.id ? model : undefined,
      ),
    },
  }

  async function emitAgentEnd(messages?: AgentEndEvent['messages']) {
    const handler = agentEndHandler
    if (!handler) throw new Error('Expected Pi Waggle loop to register an agent_end handler')
    await handler(agentEndEvent(messages), ctx)
  }

  return { api, ctx, emitAgentEnd }
}

describe('pi-waggle loop metadata', () => {
  it('passes current turn metadata and messages to the completion callback', async () => {
    const waggleConfig = config()
    const harness = createHarness()
    const onTurnComplete = vi.fn(() => ({ continue: false }))

    registerPiWaggleLoop(
      {
        config: waggleConfig,
        createTurnMetadata: ({ turnNumber, agentIndex }) =>
          metadata(waggleConfig, turnNumber, agentIndex),
        onTurnComplete,
        buildTurnMessage: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      },
      harness.api,
    )

    await harness.emitAgentEnd()

    expect(onTurnComplete).toHaveBeenCalledWith({
      turn: {
        turnNumber: FIRST_TURN_NUMBER,
        agentIndex: FIRST_AGENT_INDEX,
        agent: waggleConfig.agents[FIRST_AGENT_INDEX],
      },
      meta: { turnNumber: FIRST_TURN_NUMBER, agentIndex: FIRST_AGENT_INDEX, label: 'Architect' },
      messages: [],
    })
  })
})
