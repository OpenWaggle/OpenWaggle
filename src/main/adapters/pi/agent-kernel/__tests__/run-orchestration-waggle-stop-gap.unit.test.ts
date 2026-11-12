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
/**
 * A Waggle Run whose Stop is pressed after its first turn settles, in the gap before the next
 * turn starts, when no Pi run is active for Stop to abort.
 */
async function waggleRunStoppedBetweenTurns() {
  const sessionMessages: unknown[] = []
  const fakePi = createFakePi()
  const session = createFakeSession(fakePi.getAgentEndHandler, sessionMessages)
  const stop = new AbortController()
  let turns = 0
  vi.mocked(fakePi.pi.sendMessage).mockImplementation((message, options) => {
    if (!isRecord(options) || options.triggerTurn !== true) return
    turns += 1
    const answer = assistantMessage(`turn ${String(turns + 1)}`)
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
    runId: 'run-waggle-stop-gap',
    payload: payload('Compare the design'),
    model: PRIMARY_MODEL,
    signal: stop.signal,
    onEvent: vi.fn(),
    waggle: {
      config: waggleConfig(),
      inheritedModel: PRIMARY_MODEL,
      onWaggleEvent: vi.fn(),
      onTurnEvent: (event) => {
        if (event.type === 'turn-end') stop.abort()
      },
    },
  })
  return { result, triggeredTurns: () => turns }
}

describe('a Waggle Run stopped between turns', () => {
  beforeEach(() => {
    for (const mock of Object.values(runMocks)) mock.mockReset()
    runMocks.resolveSessionWorkingPath.mockReturnValue('/repo')
    runMocks.createSessionManagerForSession.mockReturnValue({
      buildSessionContext: () => ({ messages: [] }),
    })
    runMocks.createSessionListener.mockReturnValue(() => undefined)
    runMocks.getPiModelAvailableThinkingLevels.mockReturnValue(['off', 'medium', 'high'])
  })

  it('ends as aborted instead of waiting for a turn that never starts', async () => {
    const { result, triggeredTurns } = await waggleRunStoppedBetweenTurns()

    expect(result).toMatchObject({ aborted: true })
    expect(result).not.toHaveProperty('terminalError')
    expect(triggeredTurns()).toBe(0)
  })
})
