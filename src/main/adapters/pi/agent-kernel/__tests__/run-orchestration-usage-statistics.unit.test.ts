import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageStatisticsObservation } from '../../../../domain/usage-statistics/usage-statistics-observations'
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

const runMocks = vi.hoisted(() => {
  const observations: UsageStatisticsObservation[] = []
  const projectReads: string[] = []
  const projectConfig: { authorization: 'ask-for-approval' | 'yolo' | 'unreadable' } = {
    authorization: 'ask-for-approval',
  }
  return {
    observations,
    projectReads,
    projectConfig,
    createPiProjectModelRuntime: vi.fn(),
    createOpenWaggleAgentSessionFromServices: vi.fn(),
    createSessionListener: vi.fn(),
    createSessionManagerForSession: vi.fn(),
    disposeOpenWagglePiSession: vi.fn(),
    getPiModelAvailableThinkingLevels: vi.fn(),
    resolveSessionWorkingPath: vi.fn(),
  }
})
vi.mock('../../pi-provider-catalog', () => ({
  createPiProjectModelRuntime: runMocks.createPiProjectModelRuntime,
  getPiModelAvailableThinkingLevels: runMocks.getPiModelAvailableThinkingLevels,
}))
vi.mock('../../pi-session-lifecycle', () => ({
  createOpenWaggleAgentSessionFromServices: runMocks.createOpenWaggleAgentSessionFromServices,
  disposeOpenWagglePiSession: runMocks.disposeOpenWagglePiSession,
}))
vi.mock('../session-listener', () => ({ createSessionListener: runMocks.createSessionListener }))
vi.mock('../session-manager', () => ({
  createSessionManagerForSession: runMocks.createSessionManagerForSession,
  resolveSessionWorkingPath: runMocks.resolveSessionWorkingPath,
  requireSessionProjectPath: runMocks.resolveSessionWorkingPath,
}))
vi.mock('../../../../config/project-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../config/project-config')>()),
  getProjectPreferencesStrict: async (projectPath: string) => {
    runMocks.projectReads.push(projectPath)
    const { authorization } = runMocks.projectConfig
    if (authorization === 'unreadable') throw new Error('invalid project config')
    return { authorizationMode: authorization }
  },
}))
vi.mock('../../../../usage-statistics/usage-statistics-enablement', () => ({
  isUsageStatisticsEnabled: () => true,
}))
vi.mock('../../../../usage-statistics/usage-statistics-recorder', () => ({
  recordUsageStatistics: (observation: UsageStatisticsObservation) =>
    runMocks.observations.push(observation),
}))

const {
  noteUsageStatisticsRunProjectDefault,
  recordUsageStatisticsRunFinished,
  recordUsageStatisticsRunStarted,
  resetUsageStatisticsRunsForTests,
  usageStatisticsRunNeedsProjectDefault,
} = await import('../../../../usage-statistics/usage-statistics-runs')

/** What the recorder adapter notes when a Run becomes active: the global default is full access. */
function startRun(runId: string, waggle: boolean) {
  recordUsageStatisticsRunStarted({
    runId,
    originCallerId: 'gui:local-user',
    waggle,
    attachments: false,
    access: { ceiling: null, sessionMode: null, globalDefault: 'yolo' },
    worktree: false,
    workerSession: false,
  })
}

function finishRun(runId: string, waggle: boolean) {
  recordUsageStatisticsRunFinished({
    runId,
    originCallerId: 'gui:local-user',
    waggle,
    thinkingLevel: 'medium',
    terminalStatus: 'completed',
  })
  const finished = runMocks.observations.find((observation) => observation.kind === 'run-finished')
  return finished?.kind === 'run-finished' ? finished.properties.access_mode : undefined
}

function waggleInput(runId: string) {
  return {
    session: sessionDetail(),
    workingPath: '/repo',
    runId,
    payload: payload('Plan it together'),
    model: PRIMARY_MODEL,
    signal: new AbortController().signal,
    onEvent: vi.fn(),
    waggle: {
      config: waggleConfig(),
      inheritedModel: PRIMARY_MODEL,
      onWaggleEvent: vi.fn(),
      onTurnEvent: vi.fn(),
    },
  }
}

describe('Pi run project default for Usage statistics', () => {
  beforeEach(() => {
    runMocks.observations.length = 0
    runMocks.projectReads.length = 0
    runMocks.projectConfig.authorization = 'ask-for-approval'
    resetUsageStatisticsRunsForTests()
    for (const mock of [
      runMocks.createPiProjectModelRuntime,
      runMocks.createOpenWaggleAgentSessionFromServices,
      runMocks.createSessionListener,
      runMocks.createSessionManagerForSession,
      runMocks.disposeOpenWagglePiSession,
      runMocks.getPiModelAvailableThinkingLevels,
      runMocks.resolveSessionWorkingPath,
    ]) {
      mock.mockReset()
    }
    const fakePi = createFakePi()
    runMocks.createPiProjectModelRuntime.mockImplementation(async (input: RuntimeFactoryInput) => {
      installRuntimeFactories(input, fakePi.pi)
      return { model: modelFromReference(input.modelReference), services: fakeRuntimeServices() }
    })
    runMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({
      session: createFakeSession(fakePi.getAgentEndHandler),
    })
    runMocks.resolveSessionWorkingPath.mockReturnValue('/repo')
    runMocks.createSessionManagerForSession.mockReturnValue({
      buildSessionContext: () => ({ messages: [] }),
    })
    runMocks.createSessionListener.mockReturnValue(() => undefined)
    runMocks.getPiModelAvailableThinkingLevels.mockReturnValue(['off', 'medium', 'high'])
  })

  it('reports a tool-less explicit Waggle in an Ask for Approval project as ask-for-approval', async () => {
    startRun('run-waggle', true)

    await runPiWaggle(waggleInput('run-waggle'))
    await vi.waitFor(() => expect(usageStatisticsRunNeedsProjectDefault('run-waggle')).toBe(false))

    expect(runMocks.projectReads).toEqual([sessionDetail().projectPath])
    expect(finishRun('run-waggle', true)).toBe('ask-for-approval')
  })

  it('counts an unreadable project config as Ask for Approval, as authorization does', async () => {
    runMocks.projectConfig.authorization = 'unreadable'
    startRun('run-waggle-unreadable', true)

    await runPiWaggle(waggleInput('run-waggle-unreadable'))
    await vi.waitFor(() =>
      expect(usageStatisticsRunNeedsProjectDefault('run-waggle-unreadable')).toBe(false),
    )

    expect(finishRun('run-waggle-unreadable', true)).toBe('ask-for-approval')
  })

  it('does not read the project config again for a classic Run the executor already noted', async () => {
    startRun('run-classic', false)
    // The Run executor notes the default from the project config it loads for every classic Run.
    noteUsageStatisticsRunProjectDefault('run-classic', 'ask-for-approval')
    runMocks.projectConfig.authorization = 'yolo'

    await runPiSession({
      session: sessionDetail(),
      workingPath: '/repo',
      runId: 'run-classic',
      payload: payload('Push the branch'),
      model: PRIMARY_MODEL,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
    })

    expect(runMocks.projectReads).toEqual([])
    expect(finishRun('run-classic', false)).toBe('ask-for-approval')
  })
})
