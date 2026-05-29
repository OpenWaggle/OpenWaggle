import { WAGGLE_INHERIT_MODEL, type WaggleConfig } from '@shared/types/waggle'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runPiWaggle } from '../waggle-run'
import {
  createFakePi,
  createFakeSession,
  modelFromReference,
  PRIMARY_MODEL,
  payload,
  type RuntimeFactoryInput,
  SECONDARY_MODEL,
  sessionDetail,
  waggleConfig,
} from './run-orchestration.test-utils'

const runMocks = vi.hoisted(() => ({
  createPiProjectModelRuntime: vi.fn(),
  createOpenWaggleAgentSessionFromServices: vi.fn(),
  createSessionListener: vi.fn(),
  createSessionManagerForSession: vi.fn(),
  disposeOpenWagglePiSession: vi.fn(),
  getPiModelAvailableThinkingLevels: vi.fn(),
  resolveSessionProjectPath: vi.fn(),
}))

vi.mock('../../pi-provider-catalog', () => ({
  createPiProjectModelRuntime: runMocks.createPiProjectModelRuntime,
  getPiModelAvailableThinkingLevels: runMocks.getPiModelAvailableThinkingLevels,
}))

vi.mock('../../pi-session-lifecycle', () => ({
  createOpenWaggleAgentSessionFromServices: runMocks.createOpenWaggleAgentSessionFromServices,
  disposeOpenWagglePiSession: runMocks.disposeOpenWagglePiSession,
}))

vi.mock('../session-listener', () => ({
  createSessionListener: runMocks.createSessionListener,
}))

vi.mock('../session-manager', () => ({
  createSessionManagerForSession: runMocks.createSessionManagerForSession,
  resolveSessionProjectPath: runMocks.resolveSessionProjectPath,
}))

function mixedConfig(): WaggleConfig {
  const baseConfig = waggleConfig()
  return {
    ...baseConfig,
    agents: [
      { ...baseConfig.agents[0], model: SECONDARY_MODEL },
      { ...baseConfig.agents[1], model: WAGGLE_INHERIT_MODEL },
    ],
  }
}

describe('Pi Waggle runtime model resolution', () => {
  beforeEach(() => {
    runMocks.createPiProjectModelRuntime.mockReset()
    runMocks.createOpenWaggleAgentSessionFromServices.mockReset()
    runMocks.createSessionListener.mockReset()
    runMocks.createSessionManagerForSession.mockReset()
    runMocks.disposeOpenWagglePiSession.mockReset()
    runMocks.getPiModelAvailableThinkingLevels.mockReset()
    runMocks.resolveSessionProjectPath.mockReset()
    runMocks.resolveSessionProjectPath.mockReturnValue('/repo')
    runMocks.createSessionManagerForSession.mockReturnValue({
      buildSessionContext: () => ({ messages: [] }),
    })
    runMocks.createSessionListener.mockReturnValue(() => undefined)
    runMocks.getPiModelAvailableThinkingLevels.mockReturnValue(['off', 'medium', 'high'])
  })

  it('uses the selected standard model for inherited agents when the first turn is pinned', async () => {
    const sessionMessages: unknown[] = []
    const fakePi = createFakePi((message) => sessionMessages.push(message))
    const session = createFakeSession(fakePi.getAgentEndHandler, sessionMessages)
    const turnEvents: unknown[] = []
    runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => {
      for (const factory of input.extensionFactories ?? []) factory(fakePi.pi)
      return { model: modelFromReference(input.modelReference), services: {} }
    })
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })

    await runPiWaggle({
      session: sessionDetail(),
      runId: 'run-waggle-pinned-first-inherited-second',
      payload: payload('Compare the design'),
      model: SECONDARY_MODEL,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      waggle: {
        config: mixedConfig(),
        inheritedModel: PRIMARY_MODEL,
        onWaggleEvent: vi.fn(),
        onTurnEvent: (event) => turnEvents.push(event),
      },
    })

    expect(runMocks.createPiProjectModelRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ modelReference: SECONDARY_MODEL }),
    )
    expect(fakePi.pi.setModel).toHaveBeenCalledWith(modelFromReference(PRIMARY_MODEL))
    expect(turnEvents).toContainEqual(
      expect.objectContaining({ type: 'turn-end', turnNumber: 1, agentModel: PRIMARY_MODEL }),
    )
  })
})
