import { MessageId, SupportedModelId } from '@shared/types/brand'
import { WAGGLE_INHERIT_MODEL, type WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { executeWaggleRun } from '../waggle-run-service'
import {
  harnessState,
  resetWaggleRunServiceMocks,
  runMock,
  session,
  sessionId,
  TestLayer,
  waggleConfig,
} from './waggle-run-service.test-harness'

const GONE = SupportedModelId('qa-router/auto')
const ANSWERED_BY = SupportedModelId('fake/fake-model-2')

const inheritingFirstAgent: WaggleConfig = {
  ...waggleConfig,
  agents: [{ ...waggleConfig.agents[0], model: WAGGLE_INHERIT_MODEL }, waggleConfig.agents[1]],
}

function startWaggle(config: WaggleConfig, model = GONE) {
  return Effect.runPromise(
    executeWaggleRun({
      sessionId,
      runId: 'run-waggle-gone-model',
      payload: { text: 'Review it', attachments: [] },
      model,
      config,
      signal: new AbortController().signal,
      onEvent: () => undefined,
      onTurnEvent: () => undefined,
    }).pipe(Effect.provide(TestLayer)),
  )
}

function answeredBy(model: SupportedModelId) {
  harnessState.session = {
    ...session,
    messages: [{ id: MessageId('a1'), role: 'assistant', parts: [], model, createdAt: 2 }],
  }
}

describe('a Waggle Run whose model is gone', () => {
  beforeEach(() => {
    resetWaggleRunServiceMocks()
    harnessState.modelsNotInCatalog.add(GONE)
  })

  it('runs an agent that inherits the Session model on the model that answered last', async () => {
    answeredBy(ANSWERED_BY)

    const result = await startWaggle(inheritingFirstAgent)

    expect(result.outcome).toBe('success')
    expect(runMock.mock.calls[0]?.[0]).toMatchObject({
      model: ANSWERED_BY,
      waggle: { inheritedModel: ANSWERED_BY },
    })
  })

  it('refuses, naming the model, when the inherited model has nothing to fall back to', async () => {
    const result = await startWaggle(inheritingFirstAgent)

    expect(result).toMatchObject({
      outcome: 'validation-error',
      message:
        'The model qa-router/auto is not available in this project. Select another model before starting Waggle mode.',
    })
    expect(runMock).not.toHaveBeenCalled()
  })

  it("refuses, naming the agent, when an agent's own model is gone", async () => {
    answeredBy(ANSWERED_BY)
    const pinnedGone: WaggleConfig = {
      ...waggleConfig,
      agents: [waggleConfig.agents[0], { ...waggleConfig.agents[1], model: GONE }],
    }

    const result = await startWaggle(pinnedGone, SupportedModelId('openai/gpt-5.4'))

    expect(result).toMatchObject({
      outcome: 'validation-error',
      message:
        'Reviewer uses qa-router/auto, which is not available in this project. Choose another model for Reviewer.',
    })
    expect(runMock).not.toHaveBeenCalled()
  })
})
