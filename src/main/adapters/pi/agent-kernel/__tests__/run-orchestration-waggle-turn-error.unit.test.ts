import { isRecord } from '@shared/utils/validation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runPiWaggle } from '../waggle-run'
import {
  assistantMessage,
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
function failedTurn(errorMessage: string) {
  return { ...assistantMessage(''), content: [], stopReason: 'error', errorMessage }
}

/** A Waggle Run whose second turn (Reviewer) ends with `reply`, then answers normally. */
async function waggleRunWithSecondTurn(reply: ReturnType<typeof failedTurn>) {
  const sessionMessages: unknown[] = []
  const fakePi = createFakePi()
  const session = createFakeSession(fakePi.getAgentEndHandler, sessionMessages)
  const turnEvents: unknown[] = []
  let turns = 0
  vi.mocked(fakePi.pi.sendMessage).mockImplementation((message, options) => {
    if (!isRecord(options) || options.triggerTurn !== true) return
    turns += 1
    const answer = turns === 1 ? reply : assistantMessage(`turn ${String(turns + 1)}`)
    sessionMessages.push(message, answer)
    void fakePi.getAgentEndHandler()?.(
      { messages: [message, answer] },
      { modelRegistry: fakePi.modelRegistry },
    )
  })
  runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => {
    installRuntimeFactories(input, fakePi.pi)
    return { model: modelFromReference(input.modelReference), services: fakeRuntimeServices() }
  })
  runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })
  const result = await runPiWaggle({
    session: sessionDetail(),
    workingPath: '/repo',
    runId: 'run-waggle-turn-error',
    payload: payload('Compare the design'),
    model: PRIMARY_MODEL,
    signal: new AbortController().signal,
    onEvent: vi.fn(),
    waggle: {
      config: waggleConfig(),
      inheritedModel: PRIMARY_MODEL,
      onWaggleEvent: vi.fn(),
      onTurnEvent: (event) => turnEvents.push(event),
    },
  })
  return { result, turnEvents, triggeredTurns: () => turns }
}

describe("a Waggle turn's final error", () => {
  beforeEach(() => {
    for (const mock of Object.values(runMocks)) mock.mockReset()
    runMocks.resolveSessionWorkingPath.mockReturnValue('/repo')
    runMocks.createSessionManagerForSession.mockReturnValue({
      buildSessionContext: () => ({ messages: [] }),
    })
    runMocks.createSessionListener.mockReturnValue(() => undefined)
    runMocks.getPiModelAvailableThinkingLevels.mockReturnValue(['off', 'medium', 'high'])
  })

  it('stops the collaboration and ends the Run with an error that cannot recover', async () => {
    const unauthorized = '401 Unauthorized: Incorrect API key provided'

    const { result, turnEvents, triggeredTurns } = await waggleRunWithSecondTurn(
      failedTurn(unauthorized),
    )

    expect(result).toMatchObject({ terminalError: unauthorized })
    expect(turnEvents).toContainEqual({
      type: 'collaboration-stopped',
      reason: `Waggle stopped because Reviewer failed: ${unauthorized}`,
    })
    expect(triggeredTurns()).toBe(1)
  })

  it('continues after a transient error Pi already retried', async () => {
    const { result, triggeredTurns } = await waggleRunWithSecondTurn(
      failedTurn('503 Service Unavailable'),
    )

    expect(triggeredTurns()).toBeGreaterThan(1)
    expect(result).not.toHaveProperty('terminalError')
  })
})
