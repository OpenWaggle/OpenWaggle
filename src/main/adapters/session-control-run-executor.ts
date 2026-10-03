import * as SqlClient from '@effect/sql/SqlClient'
import type { Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { registerAgentLoopInteractionDeadline } from '../application/agent-loop-interaction-broker'
import {
  preserveOutcomeAfterAttachmentCleanup,
  withSessionAttachmentTransition,
} from '../application/session-attachment-cleanup'
import { captureRunResultResources } from '../application/session-resource-run-result'
import { runAndCaptureWithRetainedScratch } from '../application/session-scratch-retention'
import { loadProjectConfigStrict } from '../config/project-config'
import { resolveSessionHostProjectPolicy } from '../domain/session-control/session-host-policy'
import type { AgentKernelService } from '../ports/agent-kernel-service'
import type { AgentRequestedWaggleService } from '../ports/agent-requested-waggle-service'
import type { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import type { ExtensionManagerService } from '../ports/extension-manager-service'
import type { ExtensionProjectOverridesRepository } from '../ports/extension-project-overrides-repository'
import type { ProviderService } from '../ports/provider-service'
import {
  SessionControlAttachmentService,
  type SessionControlAttachmentServiceShape,
} from '../ports/session-control-attachment-service'
import {
  type SessionControlRunExecutionInput,
  SessionControlRunExecutor,
} from '../ports/session-control-run-executor'
import type { SessionOrchestrationUpdateRepository } from '../ports/session-orchestration-update-repository'
import type { SessionProjectionRepository } from '../ports/session-projection-repository'
import type { SessionReportRepository } from '../ports/session-report-repository'
import type { SessionRepository } from '../ports/session-repository'
import type { SessionResourceImageValidator } from '../ports/session-resource-image-validator'
import type { SessionResourceRepository } from '../ports/session-resource-repository'
import type { SessionResourceStore } from '../ports/session-resource-store'
import { SettingsService } from '../services/settings-service'
import { noteUsageStatisticsRunProjectDefault } from '../usage-statistics/usage-statistics-runs'
import { startStreamBuffer } from '../utils/stream-bridge'
import { executeRegisteredRun } from './session-control-run-dispatch'
import { loadRunExecutionProfile } from './session-control-run-executor-profile'
import { publishRunStartFailure, terminalRunResult } from './session-control-run-result'
import type { ResolvedSessionRunExecution } from './session-run-execution-profile'
import {
  liveSessionAuthorityBlockReason,
  loadSessionAuthoritySnapshot,
} from './sqlite-session-live-authority'

type RunExecutorDependencies =
  | AgentKernelService
  | AgentRequestedWaggleService
  | ExtensionLifecycleRepository
  | ExtensionManagerService
  | ExtensionProjectOverridesRepository
  | ProviderService
  | SessionControlAttachmentService
  | SessionProjectionRepository
  | SessionRepository
  | SessionResourceImageValidator
  | SessionResourceRepository
  | SessionResourceStore
  | SessionOrchestrationUpdateRepository
  | SessionReportRepository
  | SqlClient.SqlClient
  | SettingsService

const AUTHORITY_DRIFT_POLL_INTERVAL_MS = 100

export function withRunAttachmentCleanup<A, E, R>(input: {
  readonly effect: Effect.Effect<A, E, R>
  readonly attachments: Pick<SessionControlAttachmentServiceShape, 'release'>
  readonly attachmentIds: readonly string[]
  readonly sessionId: string
  readonly runId: string
  readonly ownerCallerId: string
}) {
  return preserveOutcomeAfterAttachmentCleanup({
    effect: input.effect,
    cleanup: withSessionAttachmentTransition({
      sessionId: input.sessionId,
      // A replacement holds this transition while it waits for this Run to settle.
      settlingRunId: input.runId,
      effect: input.attachments.release({
        attachmentIds: input.attachmentIds,
        sessionId: input.sessionId,
        ownerCallerId: input.ownerCallerId,
      }),
    }),
    operation: 'run',
    sessionId: input.sessionId,
  })
}

function modelMultiAgentEnabled(
  settings: Settings,
  execution: ResolvedSessionRunExecution,
  runId: string,
) {
  const projectPath = execution.projectPath
  if (!projectPath) return Effect.succeed(settings.multiAgentEnabled)
  return Effect.tryPromise({
    try: () => loadProjectConfigStrict(projectPath),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  }).pipe(
    // The project's authorization default rides along for Usage statistics at no extra read.
    Effect.tap((config) =>
      Effect.sync(() =>
        noteUsageStatisticsRunProjectDefault(runId, config.preferences?.authorizationMode ?? null),
      ),
    ),
    Effect.map((config) =>
      resolveSessionHostProjectPolicy(settings, projectPath, config.sessionHost),
    ),
    Effect.map((policy) => policy.modelMultiAgentEnabled),
  )
}

function registerInteractionDeadline(input: {
  readonly execution: ResolvedSessionRunExecution
  readonly request: SessionControlRunExecutionInput
  readonly onInteractionTimeout: () => void
}) {
  startStreamBuffer(
    input.request.sessionId,
    input.execution.model,
    input.request.intent.waggle ? 'waggle' : 'classic',
  )
  return input.request.intent.interactionTimeoutMs === undefined
    ? () => undefined
    : registerAgentLoopInteractionDeadline({
        runId: input.request.runId,
        timeoutMs: input.request.intent.interactionTimeoutMs,
        onTimeout: input.onInteractionTimeout,
      })
}

/** Everything a Run needs before it reaches Pi; a failure here ends the Run with its reason. */
function prepareRun(sql: SqlClient.SqlClient, input: SessionControlRunExecutionInput) {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService
    const authorityBlock = yield* liveSessionAuthorityBlockReason(
      sql,
      input.intent.callerId,
      input.sessionId,
    )
    if (authorityBlock) {
      return yield* Effect.fail(new Error(`Run authority is no longer valid: ${authorityBlock}.`))
    }
    const execution = yield* loadRunExecutionProfile(sql, input)
    const authoritySnapshot = yield* loadSessionAuthoritySnapshot(sql, input.sessionId)
    const allowModelMultiAgent = yield* modelMultiAgentEnabled(
      yield* settingsService.get(),
      execution,
      input.runId,
    )
    return { execution, authoritySnapshot, allowModelMultiAgent }
  })
}

function executeRunAfterAttachmentAdmission(input: SessionControlRunExecutionInput) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { execution, authoritySnapshot, allowModelMultiAgent } = yield* prepareRun(
      sql,
      input,
    ).pipe(Effect.tapError((error) => Effect.sync(() => publishRunStartFailure(input, error))))
    let interactionTimedOut = false
    let checkingAuthority = false
    const authorityDriftTimer = authoritySnapshot
      ? setInterval(() => {
          if (checkingAuthority || input.controller.signal.aborted) return
          checkingAuthority = true
          void Effect.runPromise(
            liveSessionAuthorityBlockReason(sql, input.intent.callerId, input.sessionId),
          )
            .then((blockReason) => {
              if (!blockReason) return
              input.controller.abort(
                new Error('Run interrupted because its filesystem authority changed.'),
              )
            })
            .catch(() => {
              input.controller.abort(
                new Error(
                  'Run interrupted because its filesystem authority could not be verified.',
                ),
              )
            })
            .finally(() => {
              checkingAuthority = false
            })
        }, AUTHORITY_DRIFT_POLL_INTERVAL_MS)
      : undefined
    const releaseInteractionDeadline = registerInteractionDeadline({
      execution,
      request: input,
      onInteractionTimeout: () => {
        interactionTimedOut = true
        input.controller.abort(
          new Error('Run interrupted because its interaction deadline expired.'),
        )
      },
    })
    // Held through resource capture too, so images the agent embedded from its scratch directory
    // are captured even when the Session was archived during the Run.
    const registered = yield* runAndCaptureWithRetainedScratch({
      sessionId: input.sessionId,
      run: executeRegisteredRun({
        request: input,
        execution,
        controller: input.controller,
        allowModelMultiAgent,
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            releaseInteractionDeadline()
            if (authorityDriftTimer) clearInterval(authorityDriftTimer)
          }),
        ),
      ),
      capture: (result) =>
        captureRunResultResources(
          input.sessionId,
          input.runId,
          result.payload,
          result.resourceResult,
        ),
    })
    const ending = {
      ...(registered.terminalEventAt === undefined
        ? {}
        : { terminalEventAt: registered.terminalEventAt }),
      ...('failure' in registered && registered.failure ? { failure: registered.failure } : {}),
    }
    return registered.mode === 'waggle'
      ? { ...registered.result, ...ending }
      : { ...terminalRunResult(registered.result, interactionTimedOut), ...ending }
  })
}

function executeRun(input: SessionControlRunExecutionInput) {
  return Effect.gen(function* () {
    const attachments = yield* SessionControlAttachmentService
    return yield* withRunAttachmentCleanup({
      effect: executeRunAfterAttachmentAdmission(input),
      attachments,
      attachmentIds: input.intent.attachmentIds,
      sessionId: input.sessionId,
      runId: input.runId,
      ownerCallerId: input.intent.callerId,
    })
  })
}

export const SessionControlRunExecutorLive = Layer.effect(
  SessionControlRunExecutor,
  Effect.gen(function* () {
    const dependencies = yield* Effect.context<RunExecutorDependencies>()
    return SessionControlRunExecutor.of({
      execute: (input) => executeRun(input).pipe(Effect.provide(dependencies)),
    })
  }),
)
