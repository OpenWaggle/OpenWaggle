import { SessionBranchId, SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import {
  WAGGLE_INHERIT_MODEL,
  type WaggleConfig,
  type WaggleStreamMetadata,
} from '@shared/types/waggle'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { executeWaggleRun } from '../waggle-run-service'
import {
  clearActiveRunMock,
  clearInterruptedRunsMock,
  persistSnapshotMock,
  recordActiveRunMock,
  resetWaggleRunServiceMocks,
  runMock,
  selectedModel,
  session,
  sessionId,
  TestLayer,
  waggleConfig,
} from './waggle-run-service.test-harness'

function runInput(config: WaggleConfig, runId: string, model = selectedModel) {
  return {
    sessionId,
    runId,
    payload: { text: 'Review the implementation', thinkingLevel: 'medium', attachments: [] },
    model,
    config,
    signal: new AbortController().signal,
    onEvent: () => undefined,
    onTurnEvent: () => undefined,
  } as const
}

describe('executeWaggleRun', () => {
  beforeEach(() => {
    resetWaggleRunServiceMocks()
  })

  it('rejects configs with more than two agents before invoking the kernel', async () => {
    const configWithThirdAgent = fromAny<WaggleConfig, unknown>({
      ...waggleConfig,
      agents: [...waggleConfig.agents, { ...waggleConfig.agents[0], label: 'Mediator' }],
    })

    const result = await Effect.runPromise(
      executeWaggleRun(runInput(configWithThirdAgent, 'run-invalid-waggle')).pipe(
        Effect.provide(TestLayer),
      ),
    )

    expect(result).toMatchObject({
      outcome: 'validation-error',
      message: 'Invalid Waggle mode configuration',
    })
    expect(runMock).not.toHaveBeenCalled()
    expect(recordActiveRunMock).not.toHaveBeenCalled()
  })

  it('resolves inherited first-agent model for runtime and active-run persistence', async () => {
    const inheritedConfig: WaggleConfig = {
      ...waggleConfig,
      agents: [{ ...waggleConfig.agents[0], model: WAGGLE_INHERIT_MODEL }, waggleConfig.agents[1]],
    }

    const result = await Effect.runPromise(
      executeWaggleRun(runInput(inheritedConfig, 'run-waggle-inherited-model')).pipe(
        Effect.provide(TestLayer),
      ),
    )

    expect(result.outcome).toBe('success')
    const [kernelInput] = runMock.mock.calls[0] ?? []
    expect(kernelInput).toMatchObject({
      model: selectedModel,
      waggle: { config: inheritedConfig, inheritedModel: selectedModel },
    })
    expect(recordActiveRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: selectedModel }),
    )
  })

  it('rejects inherited Waggle models before invoking the kernel when no standard model is selected', async () => {
    const inheritedConfig: WaggleConfig = {
      ...waggleConfig,
      agents: [{ ...waggleConfig.agents[0], model: WAGGLE_INHERIT_MODEL }, waggleConfig.agents[1]],
    }

    const result = await Effect.runPromise(
      executeWaggleRun(
        runInput(inheritedConfig, 'run-waggle-missing-selected-model', SupportedModelId('')),
      ).pipe(Effect.provide(TestLayer)),
    )

    expect(result).toMatchObject({
      outcome: 'validation-error',
      message: 'Select a model before starting Waggle mode.',
    })
    expect(runMock).not.toHaveBeenCalled()
    expect(recordActiveRunMock).not.toHaveBeenCalled()
  })

  it('keeps inherited model separate from the pinned first-turn runtime model', async () => {
    const pinnedFirstAgentConfig: WaggleConfig = {
      ...waggleConfig,
      agents: [
        { ...waggleConfig.agents[0], model: waggleConfig.agents[1].model },
        { ...waggleConfig.agents[1], model: WAGGLE_INHERIT_MODEL },
      ],
    }

    const result = await Effect.runPromise(
      executeWaggleRun(runInput(pinnedFirstAgentConfig, 'run-waggle-pinned-first')).pipe(
        Effect.provide(TestLayer),
      ),
    )

    expect(result.outcome).toBe('success')
    const [kernelInput] = runMock.mock.calls[0] ?? []
    expect(kernelInput).toMatchObject({
      model: waggleConfig.agents[1].model,
      waggle: {
        config: pinnedFirstAgentConfig,
        inheritedModel: selectedModel,
      },
    })
    expect(recordActiveRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: waggleConfig.agents[1].model }),
    )
  })

  it('delegates the full collaboration to a single Pi-native Waggle kernel run', async () => {
    const emitted: Array<{
      readonly event: AgentTransportEvent
      readonly meta: WaggleStreamMetadata
    }> = []

    const result = await Effect.runPromise(
      executeWaggleRun({
        ...runInput(waggleConfig, 'run-waggle-1'),
        onEvent: (event, meta) => emitted.push({ event, meta }),
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result.outcome).toBe('success')
    expect(runMock).toHaveBeenCalledOnce()
    const [kernelInput] = runMock.mock.calls[0] ?? []
    expect(kernelInput).toMatchObject({
      session,
      runId: 'run-waggle-1',
      model: waggleConfig.agents[0].model,
      skillToggles: { 'code-review': false },
      waggle: { config: waggleConfig, inheritedModel: selectedModel },
    })
    expect(recordActiveRunMock).toHaveBeenCalledWith({
      runId: 'run-waggle-1',
      sessionId,
      branchId: SessionBranchId('session-1:main'),
      runMode: 'waggle',
      model: waggleConfig.agents[0].model,
    })
    expect(clearInterruptedRunsMock).toHaveBeenCalledWith({
      sessionId,
      branchId: SessionBranchId('session-1:main'),
    })
    expect(emitted[0]?.meta.agentLabel).toBe('Architect')

    if (result.outcome !== 'success') {
      throw new Error('Expected successful Waggle result')
    }
    expect(result.newMessages[0]?.role).toBe('user')
    expect(result.newMessages[1]?.role).toBe('assistant')
    expect(persistSnapshotMock).toHaveBeenCalledOnce()
    expect(persistSnapshotMock.mock.calls[0]?.[0].nodes[0]?.metadataJson).toContain('Architect')
    expect(clearActiveRunMock).toHaveBeenCalledWith({ sessionId, runId: 'run-waggle-1' })
  })
})
