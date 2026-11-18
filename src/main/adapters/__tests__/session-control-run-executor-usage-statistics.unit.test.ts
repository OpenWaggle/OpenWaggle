import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageStatisticsObservation } from '../../domain/usage-statistics/usage-statistics-observations'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { SessionControlRunExecutor } from '../../ports/session-control-run-executor'
import { SettingsService } from '../../services/settings-service'

const harness = vi.hoisted(() => {
  const observations: UsageStatisticsObservation[] = []
  const projectReads: string[] = []
  return { observations, projectReads }
})

vi.mock('../session-control-run-dispatch', async () => {
  const runs = await import('../../usage-statistics/usage-statistics-runs')
  return {
    executeRegisteredRun: (input: { readonly request: { readonly runId: string } }) =>
      Effect.sync(() => {
        // What the Pi adapter notes when the Run reaches a model.
        runs.noteUsageStatisticsRunModel(
          input.request.runId,
          { provider: 'openai', model: 'gpt-5' },
          'high',
        )
        const result = { outcome: 'success', newMessages: [], resourceMessages: [] }
        return { mode: 'classic', result, resourceResult: result, payload: { text: 'Go.' } }
      }),
  }
})
vi.mock('../../application/session-resource-run-result', () => ({
  captureRunResultResources: () => Effect.void,
}))
vi.mock('../sqlite-session-live-authority', () => ({
  liveSessionAuthorityBlockReason: () => Effect.succeed(undefined),
  loadSessionAuthoritySnapshot: () => Effect.succeed(undefined),
}))
vi.mock('../session-control-run-executor-profile', () => ({
  loadRunExecutionProfile: () => Effect.succeed({ model: 'provider/model', projectPath: '/repo' }),
}))
vi.mock('../../config/project-config', () => ({
  loadProjectConfigStrict: async (projectPath: string) => {
    harness.projectReads.push(projectPath)
    return { preferences: { authorizationMode: 'ask-for-approval' } }
  },
}))
vi.mock('../../utils/stream-bridge', () => ({ startStreamBuffer: vi.fn() }))
vi.mock('../../usage-statistics/usage-statistics-enablement', () => ({
  isUsageStatisticsEnabled: () => true,
}))
vi.mock('../../usage-statistics/usage-statistics-recorder', () => ({
  recordUsageStatistics: (observation: UsageStatisticsObservation) =>
    harness.observations.push(observation),
}))

const { SessionControlRunExecutorLive } = await import('../session-control-run-executor')
const {
  recordUsageStatisticsRunFinished,
  recordUsageStatisticsRunStarted,
  resetUsageStatisticsRunsForTests,
} = await import('../../usage-statistics/usage-statistics-runs')

describe('Session Control Run executor project default for Usage statistics', () => {
  beforeEach(() => {
    harness.observations.length = 0
    harness.projectReads.length = 0
    resetUsageStatisticsRunsForTests()
  })

  it('reports a tool-less classic Run in an Ask for Approval project as ask-for-approval', async () => {
    const runId = RunId('run-classic')
    // What the recorder adapter notes when the Run becomes active: the global default is yolo.
    recordUsageStatisticsRunStarted({
      runId,
      originCallerId: 'gui:local-user',
      waggle: false,
      attachments: false,
      access: { ceiling: null, sessionMode: null, globalDefault: 'yolo' },
      worktree: false,
      workerSession: false,
    })
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, fromPartial<SqlClient.SqlClient>({})),
      Layer.succeed(SettingsService, fromPartial({ get: () => Effect.succeed(DEFAULT_SETTINGS) })),
      Layer.succeed(SessionControlAttachmentService, fromPartial({ release: () => Effect.void })),
    )
    const context = fromPartial<
      Context.Context<Layer.Layer.Context<typeof SessionControlRunExecutorLive>>
    >(Context.empty())

    await Effect.runPromise(
      Effect.flatMap(SessionControlRunExecutor, (executor) =>
        executor.execute({
          sessionId: SessionId('session-classic'),
          runId,
          intent: fromPartial({ callerId: 'gui:local-user', text: 'Go.', attachmentIds: [] }),
          controller: new AbortController(),
        }),
      ).pipe(
        Effect.provide(SessionControlRunExecutorLive),
        Effect.provide(services),
        Effect.provide(context),
      ),
    )
    recordUsageStatisticsRunFinished({
      runId,
      originCallerId: 'gui:local-user',
      waggle: false,
      thinkingLevel: 'high',
      terminalStatus: 'completed',
    })

    // The executor reads the project config once, for its own policy, and the default rides along.
    expect(harness.projectReads).toEqual(['/repo'])
    expect(harness.observations).toContainEqual({
      kind: 'run-finished',
      properties: expect.objectContaining({ access_mode: 'ask-for-approval' }),
    })
  })
})
