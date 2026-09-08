import { WAGGLE_INHERIT_MODEL, type WaggleConfig } from '@shared/types/waggle'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runPiSession } from '../classic-run'
import { runPiWaggle } from '../waggle-run'
import { EXPECTED_WAGGLE_TURN_EVENTS, WAGGLE_ATTACHMENTS } from './run-orchestration.fixtures'
import {
  createFakePi,
  createFakeSession,
  fakeRuntimeServices,
  installRuntimeFactories,
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
describe('Pi run orchestration', () => {
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
  it('runs a classic Pi prompt with project runtime, listener subscription, and disposal', async () => {
    const fakePi = createFakePi()
    const session = createFakeSession(fakePi.getAgentEndHandler)
    runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => ({
      model: modelFromReference(input.modelReference),
      services: fakeRuntimeServices(),
    }))
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })
    const result = await runPiSession({
      session: sessionDetail(),
      // The kernel resolves (and births) this before calling the run functions.
      workingPath: '/repo',
      runId: 'run-1',
      payload: payload('Run tests'),
      model: PRIMARY_MODEL,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
    })
    expect(runMocks.createPiProjectModelRuntime).toHaveBeenCalledWith({
      projectPath: '/repo',
      modelReference: PRIMARY_MODEL,
    })
    expect(session.subscribe).toHaveBeenCalledOnce()
    expect(session.prompt).toHaveBeenCalledWith('Run tests', undefined)
    expect(session.agent.waitForIdle).toHaveBeenCalled()
    expect(session.agent.hasQueuedMessages).toHaveBeenCalled()
    expect(result.newMessages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(runMocks.disposeOpenWagglePiSession).toHaveBeenCalledWith(session)
  })
  it('installs every inline extension factory for classic and Waggle runs', async () => {
    const fakePi = createFakePi()
    const session = createFakeSession(fakePi.getAgentEndHandler)
    const classicFactory = vi.fn()
    const waggleFactory = vi.fn()
    const classicTrustedFactory = vi.fn()
    const waggleTrustedFactory = vi.fn()
    runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => {
      installRuntimeFactories(input, fakePi.pi)
      return { model: modelFromReference(input.modelReference), services: fakeRuntimeServices() }
    })
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })

    await runPiSession({
      session: sessionDetail(),
      workingPath: '/repo',
      runId: 'run-classic-extensions',
      payload: payload('Run classic tools'),
      model: PRIMARY_MODEL,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      extensionFactories: [classicFactory],
      trustedExtensionFactories: [classicTrustedFactory],
      systemPromptAppendices: ['Classic browser guidance'],
    })
    await runPiWaggle({
      session: sessionDetail(),
      workingPath: '/repo',
      runId: 'run-waggle-extensions',
      payload: payload('Run collaborative tools'),
      model: PRIMARY_MODEL,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      extensionFactories: [waggleFactory],
      trustedExtensionFactories: [waggleTrustedFactory],
      systemPromptAppendices: ['Waggle browser guidance'],
      waggle: {
        config: waggleConfig(),
        inheritedModel: PRIMARY_MODEL,
        onWaggleEvent: vi.fn(),
        onTurnEvent: vi.fn(),
      },
    })

    expect(classicFactory).toHaveBeenCalledExactlyOnceWith(fakePi.pi)
    expect(waggleFactory).toHaveBeenCalledExactlyOnceWith(fakePi.pi)
    expect(classicTrustedFactory).toHaveBeenCalledExactlyOnceWith(fakePi.pi)
    expect(waggleTrustedFactory).toHaveBeenCalledExactlyOnceWith(fakePi.pi)
    expect(runMocks.createPiProjectModelRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ systemPromptAppendices: ['Classic browser guidance'] }),
    )
    expect(runMocks.createPiProjectModelRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ systemPromptAppendices: ['Waggle browser guidance'] }),
    )
  })
  it('keeps original text and image attachments in OpenWaggle Waggle turn prompts', async () => {
    const fakePi = createFakePi()
    const session = createFakeSession(fakePi.getAgentEndHandler)
    const config = waggleConfig()
    runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => {
      installRuntimeFactories(input, fakePi.pi)
      return { model: modelFromReference(input.modelReference), services: fakeRuntimeServices() }
    })
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })
    await runPiWaggle({
      session: sessionDetail(),
      workingPath: '/repo',
      runId: 'run-waggle-attachments',
      payload: payload('Review attached context', { attachments: WAGGLE_ATTACHMENTS }),
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
    expect(session.sendCustomMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        customType: 'pi-waggle.user-request',
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('Important notes for every Waggle turn'),
          }),
          expect.objectContaining({ type: 'image', data: 'base64-image', mimeType: 'image/png' }),
        ]),
      }),
      { triggerTurn: false },
    )
    expect(session.sendCustomMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        customType: 'pi-waggle.turn',
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('[Attachment: diagram.png]'),
          }),
          expect.objectContaining({ type: 'image', data: 'base64-image', mimeType: 'image/png' }),
        ]),
      }),
      { triggerTurn: true },
    )
  })
  it('resolves inherited Waggle agent models to the selected standard model before Pi lookup', async () => {
    const fakePi = createFakePi()
    const session = createFakeSession(fakePi.getAgentEndHandler)
    const baseConfig = waggleConfig()
    const inheritedConfig: WaggleConfig = {
      ...baseConfig,
      agents: [{ ...baseConfig.agents[0], model: WAGGLE_INHERIT_MODEL }, baseConfig.agents[1]],
    }
    const turnEvents: unknown[] = []
    runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => {
      installRuntimeFactories(input, fakePi.pi)
      return { model: modelFromReference(input.modelReference), services: fakeRuntimeServices() }
    })
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })
    await runPiWaggle({
      session: sessionDetail(),
      workingPath: '/repo',
      runId: 'run-waggle-inherited-model',
      payload: payload('Compare the design'),
      model: PRIMARY_MODEL,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      waggle: {
        config: inheritedConfig,
        inheritedModel: PRIMARY_MODEL,
        onWaggleEvent: vi.fn(),
        onTurnEvent: (event) => turnEvents.push(event),
      },
    })
    expect(runMocks.createPiProjectModelRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ modelReference: PRIMARY_MODEL }),
    )
    expect(turnEvents).toContainEqual(
      expect.objectContaining({ type: 'turn-end', turnNumber: 0, agentModel: PRIMARY_MODEL }),
    )
    expect(fakePi.pi.setModel).toHaveBeenCalledWith(modelFromReference(SECONDARY_MODEL))
  })
  it('drives Waggle turns through hidden turn messages and agent turn decisions', async () => {
    const sessionMessages: unknown[] = []
    const fakePi = createFakePi((message) => sessionMessages.push(message))
    const session = createFakeSession(fakePi.getAgentEndHandler, sessionMessages)
    const config = waggleConfig()
    const turnEvents: unknown[] = []
    runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => {
      installRuntimeFactories(input, fakePi.pi)
      return { model: modelFromReference(input.modelReference), services: fakeRuntimeServices() }
    })
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })
    const result = await runPiWaggle({
      session: sessionDetail(),
      workingPath: '/repo',
      runId: 'run-waggle',
      payload: payload('Compare the design'),
      model: PRIMARY_MODEL,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      waggle: {
        config,
        inheritedModel: PRIMARY_MODEL,
        onWaggleEvent: vi.fn(),
        onTurnEvent: (event) => turnEvents.push(event),
      },
    })
    expect(runMocks.createPiProjectModelRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ modelReference: PRIMARY_MODEL }),
    )
    expect(session.sendCustomMessage).toHaveBeenCalledTimes(2)
    expect(fakePi.pi.setModel).toHaveBeenCalledWith(modelFromReference(SECONDARY_MODEL))
    expect(fakePi.pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ customType: 'pi-waggle.turn', display: false }),
      { triggerTurn: true },
    )
    expect(session.sessionManager.appendCustomEntry).toHaveBeenCalledWith(
      'pi-waggle.mode-state',
      expect.objectContaining({ enabled: true, config }),
    )
    expect(session.agent.waitForIdle).toHaveBeenCalled()
    expect(session.agent.hasQueuedMessages).toHaveBeenCalled()
    expect(turnEvents).toEqual(EXPECTED_WAGGLE_TURN_EVENTS)
    expect(result.newMessages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'assistant',
      'assistant',
      'assistant',
    ])
    expect(session.setModel).toHaveBeenCalledWith(modelFromReference(PRIMARY_MODEL))
    expect(runMocks.disposeOpenWagglePiSession).toHaveBeenCalledWith(session)
  })
})
