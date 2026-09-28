import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type * as SqlClient from '@effect/sql/SqlClient'
import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationRequest,
} from '@shared/types/session-control'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schedule from 'effect/Schedule'
import { afterEach, beforeEach } from 'vitest'
import { makeHiveWorkerCleanupTestLayer } from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import { AgentRunInterruptionService } from '../../ports/agent-run-interruption-service'
import { AgentSteeringService } from '../../ports/agent-steering-service'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRunExecutor } from '../../ports/session-control-run-executor'
import { SessionDescendantRunRepository } from '../../ports/session-descendant-run-repository'
import { SessionExportArtifactWriter } from '../../ports/session-export-artifact-writer'
import { SessionExportLiveAuthority } from '../../ports/session-export-live-authority'
import { SessionExportOperationRepository } from '../../ports/session-export-operation-repository'
import { SessionExportResourceResolver } from '../../ports/session-export-resource-resolver'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import { SessionReportDeliveryService } from '../../ports/session-report-delivery-service'
import { SessionReportRepository } from '../../ports/session-report-repository'
import { installSessionHostEventPublisher } from '../../session-host/session-host-events'
import { activeRuns, hasAnyActiveRun } from '../active-session-runs'
import { makeHiveWorkerCleanupLayer } from '../hive-worker-cleanup-service'
import { executeSessionControlMutation } from '../session-control-command-service'
import { startSessionRun } from '../session-control-service'
import { executeSessionDelegationMutation } from '../session-delegation-service'

export function hiveHostLayer(databasePath: string) {
  const store = makeHiveWorkerCleanupTestLayer(databasePath)
  let runSequence = 0
  const supportLayer = Layer.mergeAll(
    Layer.succeed(SessionControlIdentityService, {
      nextRunId: Effect.sync(() => {
        runSequence += 1
        return RunId(`run-generated-${String(runSequence)}`)
      }),
      nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
      nextReportId: Effect.succeed(ReportId('report-unused')),
      nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
      now: Effect.succeed(5000),
    }),
    Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
      deliverPendingToActiveRun: () => Effect.succeed(false),
      deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
    }),
  )
  const cleanup = makeHiveWorkerCleanupLayer('inline').pipe(Layer.provide(store))
  return Layer.mergeAll(store, supportLayer, cleanup)
}

/** Adds the collaborators the full Session Control command path needs but these flows never use. */
export function commandHostLayer(databasePath: string) {
  return Layer.mergeAll(
    hiveHostLayer(databasePath),
    Layer.succeed(SessionControlRunExecutor, {
      execute: () =>
        Effect.succeed({ terminalStatus: 'completed' as const, finalResponse: 'Done.' }),
    }),
    Layer.succeed(AgentRunInterruptionService, fromPartial({})),
    Layer.succeed(AgentSteeringService, fromPartial({})),
    Layer.succeed(SessionAuthorizationTargetRepository, fromPartial({})),
    Layer.succeed(SessionControlAttachmentService, fromPartial({})),
    Layer.succeed(SessionDescendantRunRepository, fromPartial({})),
    Layer.succeed(SessionExportArtifactWriter, fromPartial({})),
    Layer.succeed(SessionExportLiveAuthority, fromPartial({})),
    Layer.succeed(SessionExportOperationRepository, fromPartial({})),
    Layer.succeed(SessionExportResourceResolver, fromPartial({})),
    Layer.succeed(SessionProjectionRepository, fromPartial({})),
    Layer.succeed(SessionQueryRepository, fromPartial({})),
    Layer.succeed(SessionReportDeliveryService, fromPartial({})),
    Layer.succeed(SessionReportRepository, fromPartial({})),
  )
}

export function delegationCommand(
  callerId: string,
  key: string,
  command:
    | {
        readonly operation: 'delegation-accept'
        readonly sessionId: string
        readonly delegationId: string
      }
    | {
        readonly operation: 'delegation-request-revision'
        readonly sessionId: string
        readonly delegationId: string
      },
) {
  return executeSessionDelegationMutation({
    callerId,
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: key,
      idempotencyKey: key,
      command:
        command.operation === 'delegation-accept'
          ? { ...command, submissionRevision: 1 }
          : { ...command, submissionRevision: 1, feedback: 'Cover the error path too.' },
    },
  })
}

/** Runs `command` through the full Session Control command path, as the `sessions` tool does. */
export function controlCommandAs(
  callerId: string,
  key: string,
  command: SessionControlMutationRequest['command'],
) {
  return executeSessionControlMutation({
    callerId,
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: key,
      idempotencyKey: key,
      command,
    },
  })
}

/** The forked Run coordinator settles asynchronously after the command returns. */
export function waitForSessionIdle(sessionId: string) {
  return Effect.suspend(() =>
    hasAnyActiveRun(SessionId(sessionId)) ? Effect.fail('busy' as const) : Effect.void,
  ).pipe(Effect.retry(Schedule.spaced('10 millis').pipe(Schedule.upTo('5 seconds'))))
}

export function archiveStateJournal(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<{ readonly caller_id: string; readonly operation: string }>`
    SELECT caller_id, operation FROM session_operations
    WHERE target_scope = ${sessionId} AND operation IN (${'archive'}, ${'unarchive'})
    ORDER BY id
  `
}

export function seedQueenAuthority(sql: SqlClient.SqlClient, projectPath: string) {
  return Effect.gen(function* () {
    yield* sql.unsafe(`CREATE TABLE settings_store (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    yield* sql`UPDATE sessions SET project_path = ${projectPath}`
  })
}

export function archived(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<{ readonly archived: number }>`
    SELECT archived FROM sessions WHERE id = ${sessionId}
  `.pipe(Effect.map((rows) => rows[0]?.archived === 1))
}

export function startAs(callerId: string, sessionId: string, key: string) {
  return startSessionRun({
    callerId,
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: key,
      idempotencyKey: key,
      command: {
        operation: 'start',
        sessionId,
        input: { text: 'Check one more thing.', attachmentIds: [] },
      },
    },
  })
}

/** Temporary database root and captured Session Host events, reset around every test. */
export function useHiveHostTestContext(prefix: string) {
  const context: { temporaryRoot: string; events: SessionHostEventPayload[] } = {
    temporaryRoot: '',
    events: [],
  }
  let releasePublisher: (() => void) | undefined
  beforeEach(async () => {
    context.temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    context.events = []
    releasePublisher = installSessionHostEventPublisher((event) => context.events.push(event))
  })
  afterEach(async () => {
    for (const sessionId of activeRuns.keys()) activeRuns.delete(sessionId)
    releasePublisher?.()
    await fs.rm(context.temporaryRoot, { recursive: true, force: true })
  })
  return context
}
