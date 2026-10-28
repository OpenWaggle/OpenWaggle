import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runPiSession } from '../classic-run'
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
} from './run-orchestration.test-utils'

const runMocks = vi.hoisted(() => ({
  createPiProjectModelRuntime: vi.fn(),
  createOpenWaggleAgentSessionFromServices: vi.fn(),
  createSessionListener: vi.fn(),
  createSessionManagerForSession: vi.fn(),
  disposeOpenWagglePiSession: vi.fn(),
  getPiModelAvailableThinkingLevels: vi.fn(),
  resolveSessionWorkingPath: vi.fn(),
  captureTurnCheckpoint: vi.fn(async () => undefined),
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
vi.mock('../turn-capture', () => ({
  captureTurnCheckpoint: runMocks.captureTurnCheckpoint,
  piSessionFileOf: () => ({}),
}))

type Listener = (event: unknown) => void

/** A Pi session whose prompt executes `toolNames`, as Pi reports them to subscribers. */
function sessionRunningTools(toolNames: readonly string[]) {
  const fakePi = createFakePi()
  const base = createFakeSession(fakePi.getAgentEndHandler)
  const listeners = new Set<Listener>()
  const session = {
    ...base,
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    prompt: async (text: string) => {
      for (const toolName of toolNames) {
        for (const listener of listeners)
          listener({ type: 'tool_execution_start', toolCallId: toolName, toolName, args: {} })
      }
      await base.prompt(text)
    },
  }
  runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => {
    installRuntimeFactories(input, fakePi.pi)
    return { model: modelFromReference(input.modelReference), services: fakeRuntimeServices() }
  })
  runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })
  return { listenerCount: () => listeners.size }
}

async function runWithTools(toolNames: readonly string[]) {
  const harness = sessionRunningTools(toolNames)
  await runPiSession({
    session: sessionDetail(),
    workingPath: '/repo',
    runId: 'run-checkpoint',
    payload: payload('Look around'),
    model: PRIMARY_MODEL,
    signal: new AbortController().signal,
    onEvent: vi.fn(),
  })
  return harness
}

describe('a classic Run tells its turn checkpoint whether files may have changed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runMocks.resolveSessionWorkingPath.mockReturnValue('/repo')
    runMocks.createSessionManagerForSession.mockReturnValue({
      buildSessionContext: () => ({ messages: [] }),
    })
    runMocks.createSessionListener.mockReturnValue(() => undefined)
    runMocks.getPiModelAvailableThinkingLevels.mockReturnValue(['off', 'medium', 'high'])
  })

  it('reports no change for a Run that only read', async () => {
    const harness = await runWithTools(['read', 'grep'])

    expect(runMocks.captureTurnCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-checkpoint', workspaceMayHaveChanged: false }),
    )
    expect(harness.listenerCount()).toBe(0)
  })

  it('reports a possible change for a Run that ran a shell command', async () => {
    await runWithTools(['read', 'bash'])

    expect(runMocks.captureTurnCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceMayHaveChanged: true }),
    )
  })
})
