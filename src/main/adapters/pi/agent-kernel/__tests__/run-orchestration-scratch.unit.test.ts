import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runPiSession } from '../classic-run'
import { runPiWaggle } from '../waggle-run'
import {
  createFakePi,
  createFakeSession,
  fakeRuntimeServices,
  installRuntimeFactories,
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
describe('Pi run scratch directory prompt', () => {
  beforeEach(() => {
    runMocks.createPiProjectModelRuntime.mockReset()
    runMocks.createOpenWaggleAgentSessionFromServices.mockReset()
    runMocks.createSessionListener.mockReset()
    runMocks.createSessionManagerForSession.mockReset()
    runMocks.disposeOpenWagglePiSession.mockReset()
    runMocks.getPiModelAvailableThinkingLevels.mockReset()
    runMocks.resolveSessionWorkingPath.mockReset()
    runMocks.resolveSessionWorkingPath.mockReturnValue('/repo')
    runMocks.createSessionManagerForSession.mockReturnValue({
      buildSessionContext: () => ({ messages: [] }),
    })
    runMocks.createSessionListener.mockReturnValue(() => undefined)
    runMocks.getPiModelAvailableThinkingLevels.mockReturnValue(['off', 'medium', 'high'])
  })
  it('names the Session scratch directory in the system prompt of classic and Waggle runs', async () => {
    const fakePi = createFakePi()
    const session = createFakeSession(fakePi.getAgentEndHandler)
    runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => {
      installRuntimeFactories(input, fakePi.pi)
      return { model: modelFromReference(input.modelReference), services: fakeRuntimeServices() }
    })
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })
    const scratchDirectory = '/tmp/ow-scratch-501/37a8eec1/0123456789ab'

    await runPiSession({
      session: sessionDetail(),
      workingPath: '/repo',
      runId: 'run-classic-scratch',
      payload: payload('Push the branch'),
      model: PRIMARY_MODEL,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      scratchDirectory,
    })
    await runPiWaggle({
      session: sessionDetail(),
      workingPath: '/repo',
      runId: 'run-waggle-scratch',
      payload: payload('Push the branch together'),
      model: PRIMARY_MODEL,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      scratchDirectory,
      waggle: {
        config: waggleConfig(),
        inheritedModel: PRIMARY_MODEL,
        onWaggleEvent: vi.fn(),
        onTurnEvent: vi.fn(),
      },
    })

    const prompts = runMocks.createPiProjectModelRuntime.mock.calls.map((call: unknown[]) => {
      const appendices: unknown = Reflect.get(Object(call[0]), 'systemPromptAppendices')
      return Array.isArray(appendices) ? appendices : []
    })
    expect(prompts.length).toBeGreaterThanOrEqual(2)
    for (const appendices of prompts) {
      expect(appendices.join('\n')).toContain(JSON.stringify(scratchDirectory))
    }
  })
})
