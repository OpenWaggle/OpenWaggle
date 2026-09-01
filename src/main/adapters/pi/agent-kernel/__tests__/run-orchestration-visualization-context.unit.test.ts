import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runPiSession } from '../classic-run'
import { runPiWaggle } from '../waggle-run'
import {
  createFakePi,
  createFakeSession,
  fakeRuntimeServices,
  modelFromReference,
  PRIMARY_MODEL,
  payload,
  type RuntimeFactoryInput,
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
  resolveSessionWorkingPath: vi.fn(),
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
  resolveSessionWorkingPath: runMocks.resolveSessionWorkingPath,
  requireSessionProjectPath: runMocks.resolveSessionWorkingPath,
}))

describe('Pi visualization context orchestration', () => {
  beforeEach(() => {
    for (const mock of Object.values(runMocks)) mock.mockReset()
    runMocks.resolveSessionWorkingPath.mockReturnValue('/repo')
    runMocks.createSessionManagerForSession.mockReturnValue({
      buildSessionContext: () => ({ messages: [] }),
    })
    runMocks.createSessionListener.mockReturnValue(() => undefined)
    runMocks.getPiModelAvailableThinkingLevels.mockReturnValue(['off', 'medium', 'high'])
  })

  it('sends state as hidden Pi context while preserving visible user text', async () => {
    const fakePi = createFakePi()
    const session = createFakeSession(fakePi.getAgentEndHandler)
    runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => ({
      model: modelFromReference(input.modelReference),
      services: fakeRuntimeServices(),
    }))
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })

    await runPiSession({
      session: sessionDetail(),
      workingPath: '/repo',
      runId: 'run-with-visualization-state',
      payload: payload('Explain this selection', {
        visualizationContext: {
          title: 'Service map',
          sourcePath: '/repo/service-map.html',
          state: { selectedService: 'api' },
        },
      }),
      model: PRIMARY_MODEL,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
    })

    expect(session.sendCustomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: 'openwaggle.inline-visualization-context',
        display: false,
        content: expect.stringContaining('"selectedService":"api"'),
      }),
      { deliverAs: 'nextTurn', triggerTurn: false },
    )
    expect(session.prompt).toHaveBeenCalledWith('Explain this selection', undefined)
  })

  it('keeps Waggle display text clean while attaching state to its hidden turn', async () => {
    const fakePi = createFakePi()
    const session = createFakeSession(fakePi.getAgentEndHandler)
    const config = waggleConfig()
    runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => {
      for (const factory of input.extensionFactories ?? []) factory(fakePi.pi)
      return { model: modelFromReference(input.modelReference), services: fakeRuntimeServices() }
    })
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })

    await runPiWaggle({
      session: sessionDetail(),
      workingPath: '/repo',
      runId: 'waggle-with-visualization-state',
      payload: payload('Debate this selection', {
        visualizationContext: {
          title: 'Service map',
          sourcePath: '/repo/service-map.html',
          state: { selectedService: 'api' },
        },
      }),
      model: PRIMARY_MODEL,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      waggle: {
        config,
        inheritedModel: PRIMARY_MODEL,
        onWaggleEvent: vi.fn(),
        onTurnEvent: vi.fn(),
      },
    })

    const sendCustomMessage = vi.mocked(session.sendCustomMessage)
    expect(JSON.stringify(sendCustomMessage.mock.calls[0]?.[0])).not.toContain('selectedService')
    expect(JSON.stringify(sendCustomMessage.mock.calls[1]?.[0])).toContain('selectedService')
  })
})
