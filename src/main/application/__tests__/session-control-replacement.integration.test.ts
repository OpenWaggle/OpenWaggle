import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it } from 'vitest'
import { makeSessionControlTestLayer } from '../../adapters/__tests__/sqlite-session-control-test-layer'
import { AgentRunInterruptionService } from '../../ports/agent-run-interruption-service'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { replaceSessionRun } from '../session-control-replacement-service'
import { queueSessionFollowUp, submitSessionMessage } from '../session-control-service'

describe('Session Control replacement coordination', () => {
  let temporaryRoot = ''

  afterEach(async () => {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('keeps the queue intact while the old coordinator settles, then installs the replacement', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-replacement-'))
    const base = makeSessionControlTestLayer(path.join(temporaryRoot, 'state.sqlite'))
    const interruption = Layer.effect(
      AgentRunInterruptionService,
      Effect.gen(function* () {
        const lifecycle = yield* SessionControlRunLifecycleRepository
        return AgentRunInterruptionService.of({
          interrupt: ({ sessionId, runId }) =>
            lifecycle
              .settle({
                sessionId: SessionId(sessionId),
                runId: RunId(runId),
                nextRunId: RunId('run-queued'),
                terminalStatus: 'interrupted',
              })
              .pipe(Effect.orDie, Effect.as({ accepted: true as const })),
        })
      }),
    ).pipe(Layer.provide(base))
    const layer = Layer.merge(base, interruption)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* submitSessionMessage({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'start',
            idempotencyKey: 'start-key',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Original.', attachmentIds: [] },
            },
          },
        })
        yield* queueSessionFollowUp({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'queue',
            idempotencyKey: 'queue-key',
            command: {
              operation: 'follow-up',
              sessionId: 'session-target',
              input: { text: 'Remain queued.', attachmentIds: [] },
            },
          },
        })
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
        })
        const response = yield* replaceSessionRun({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'replace',
            idempotencyKey: 'replace-key',
            command: {
              operation: 'replace',
              sessionId: 'session-target',
              expectedRunId: 'run-next',
              input: { text: 'Replacement.', attachmentIds: [] },
            },
          },
        }).pipe(
          Effect.provideService(SessionControlIdentityService, {
            nextRunId: Effect.succeed(RunId('run-replacement')),
            nextFollowUpId: Effect.succeed(FollowUpId('unused')),
            nextReportId: Effect.succeed(ReportId('unused')),
            nextReportCorrelationId: Effect.succeed(ReportCorrelationId('unused')),
            now: Effect.succeed(2000),
          }),
        )
        const sql = yield* SqlClient.SqlClient
        const states = yield* sql<{ readonly active_run_id: string }>`
          SELECT active_run_id FROM session_control_states
        `
        const queued = yield* sql<{ readonly id: string }>`SELECT id FROM session_follow_ups`
        return { response, state: states[0], queued }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({
      effect: 'replaced-run',
      runId: 'run-replacement',
    })
    expect(result.state).toEqual({ active_run_id: 'run-replacement' })
    expect(result.queued).toEqual([{ id: 'follow-up-next' }])
  })
})
