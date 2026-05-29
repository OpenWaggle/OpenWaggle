import type { HydratedAgentSendPayload } from '@shared/types/agent'
import { WAGGLE_INHERIT_MODEL, type WaggleConfig } from '@shared/types/waggle'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runPiSession } from '../classic-run'
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

  it('keeps original text and image attachments in OpenWaggle Waggle turn prompts', async () => {
    const fakePi = createFakePi()
    const session = createFakeSession(fakePi.getAgentEndHandler)
    const config = waggleConfig()
    const attachments = [
      {
        id: 'img-1',
        kind: 'image',
        name: 'diagram.png',
        path: '/tmp/diagram.png',
        mimeType: 'image/png',
        sizeBytes: 128,
        extractedText: 'Architecture diagram OCR',
        source: { type: 'data', value: 'base64-image', mimeType: 'image/png' },
      },
      {
        id: 'text-1',
        kind: 'text',
        name: 'notes.txt',
        path: '/tmp/notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 64,
        extractedText: 'Important notes for every Waggle turn',
        source: null,
      },
    ] satisfies HydratedAgentSendPayload['attachments']
    runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => {
      for (const factory of input.extensionFactories ?? []) {
        factory(fakePi.pi)
      }
      return { model: modelFromReference(input.modelReference), services: {} }
    })
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })

    await runPiWaggle({
      session: sessionDetail(),
      runId: 'run-waggle-attachments',
      payload: payload('Review attached context', { attachments }),
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
      for (const factory of input.extensionFactories ?? []) {
        factory(fakePi.pi)
      }
      return { model: modelFromReference(input.modelReference), services: {} }
    })
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })

    await runPiWaggle({
      session: sessionDetail(),
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
    expect(turnEvents).toEqual([
      { type: 'turn-start', turnNumber: 0, agentIndex: 0, agentLabel: 'Architect' },
      {
        type: 'turn-end',
        turnNumber: 0,
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        agentModel: PRIMARY_MODEL,
      },
      { type: 'turn-start', turnNumber: 1, agentIndex: 1, agentLabel: 'Reviewer' },
      {
        type: 'turn-end',
        turnNumber: 1,
        agentIndex: 1,
        agentLabel: 'Reviewer',
        agentColor: 'amber',
        agentModel: SECONDARY_MODEL,
      },
      { type: 'turn-start', turnNumber: 2, agentIndex: 0, agentLabel: 'Architect' },
      {
        type: 'turn-end',
        turnNumber: 2,
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        agentModel: PRIMARY_MODEL,
      },
      { type: 'turn-start', turnNumber: 3, agentIndex: 1, agentLabel: 'Reviewer' },
      {
        type: 'turn-end',
        turnNumber: 3,
        agentIndex: 1,
        agentLabel: 'Reviewer',
        agentColor: 'amber',
        agentModel: SECONDARY_MODEL,
      },
      {
        type: 'collaboration-complete',
        reason: 'Reached maximum turns (4)',
        totalTurns: 4,
      },
    ])
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
