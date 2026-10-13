import type { ExtensionError } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
describe('a Waggle Run whose next turn cannot start', () => {
  beforeEach(() => {
    for (const mock of Object.values(runMocks)) mock.mockReset()
    runMocks.resolveSessionWorkingPath.mockReturnValue('/repo')
    runMocks.createSessionManagerForSession.mockReturnValue({
      buildSessionContext: () => ({ messages: [] }),
    })
    runMocks.createSessionListener.mockReturnValue(() => undefined)
    runMocks.getPiModelAvailableThinkingLevels.mockReturnValue(['off', 'medium', 'high'])
  })

  it('ends with the error and restores the initial model, instead of waiting for the turn', async () => {
    const fakePi = createFakePi()
    let reportExtensionError: ((error: ExtensionError) => void) | undefined
    const session = {
      ...createFakeSession(fakePi.getAgentEndHandler),
      extensionRunner: {
        onError: (listener: (error: ExtensionError) => void) => {
          reportExtensionError = listener
          return () => undefined
        },
        getRegisteredCommands: () => [],
      },
    }
    // Pi rejects the next turn's start and reports it only to the extension error listeners.
    vi.mocked(fakePi.pi.sendMessage).mockImplementation(() => {
      reportExtensionError?.({
        extensionPath: '<runtime>',
        event: 'send_message',
        error: 'Sign-in expired',
      })
    })
    runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => {
      installRuntimeFactories(input, fakePi.pi)
      return { model: modelFromReference(input.modelReference), services: fakeRuntimeServices() }
    })
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })

    const result = await runPiWaggle({
      session: sessionDetail(),
      workingPath: '/repo',
      runId: 'run-waggle-turn-start-failed',
      payload: payload('Compare the design'),
      model: PRIMARY_MODEL,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      waggle: {
        config: waggleConfig(),
        inheritedModel: PRIMARY_MODEL,
        onWaggleEvent: vi.fn(),
        onTurnEvent: vi.fn(),
      },
    })

    expect(result).toMatchObject({
      terminalError: 'An extension could not start the next turn: Sign-in expired',
    })
    expect(session.setModel).toHaveBeenLastCalledWith(modelFromReference(PRIMARY_MODEL))
  })
})
