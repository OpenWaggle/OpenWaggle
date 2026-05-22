import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runPiSession } from '../classic-run'
import { runPiWaggle } from '../waggle-run'
import {
  createFakePi,
  createFakeSession,
  metadata,
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

describe('Pi run orchestration', () => {
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

  it('runs a classic Pi prompt with project runtime, listener subscription, and disposal', async () => {
    const fakePi = createFakePi()
    const session = createFakeSession(fakePi.getAgentEndHandler)
    runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => ({
      model: modelFromReference(input.modelReference),
      services: {},
    }))
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })

    const result = await runPiSession({
      session: sessionDetail(),
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

  it('drives Waggle turns through hidden custom messages and agent turn decisions', async () => {
    const sessionMessages: unknown[] = []
    const fakePi = createFakePi((message) => sessionMessages.push(message))
    const session = createFakeSession(fakePi.getAgentEndHandler, sessionMessages)
    const config = waggleConfig()
    const turnEvents: unknown[] = []
    const turnCompletions: unknown[] = []
    runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => {
      for (const factory of input.extensionFactories ?? []) {
        factory(fakePi.pi)
      }
      return { model: modelFromReference(input.modelReference), services: {} }
    })
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })

    const result = await runPiWaggle({
      session: sessionDetail(),
      runId: 'run-waggle',
      payload: payload('Compare the design'),
      model: PRIMARY_MODEL,
      config,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      onWaggleEvent: vi.fn(),
      onTurnEvent: (event) => turnEvents.push(event),
      createTurnMetadata: ({ turnNumber, agentIndex }) => metadata(config, turnNumber, agentIndex),
      onTurnComplete: (completion) => {
        turnCompletions.push(completion)
        return { continue: turnCompletions.length === 1 }
      },
    })

    expect(runMocks.createPiProjectModelRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ modelReference: PRIMARY_MODEL }),
    )
    expect(session.sendCustomMessage).toHaveBeenCalledTimes(2)
    expect(fakePi.pi.setModel).toHaveBeenCalledWith(modelFromReference(SECONDARY_MODEL))
    expect(fakePi.pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ customType: 'openwaggle.waggle.turn', display: false }),
      { triggerTurn: true, deliverAs: 'followUp' },
    )
    expect(session.agent.waitForIdle).toHaveBeenCalled()
    expect(session.agent.hasQueuedMessages).toHaveBeenCalled()
    expect(turnEvents).toEqual([
      { type: 'turn-start', turnNumber: 0, agentIndex: 0, agentLabel: 'Architect' },
      { type: 'turn-start', turnNumber: 1, agentIndex: 1, agentLabel: 'Reviewer' },
    ])
    expect(result.newMessages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'assistant',
    ])
    expect(runMocks.disposeOpenWagglePiSession).toHaveBeenCalledWith(session)
  })
})
