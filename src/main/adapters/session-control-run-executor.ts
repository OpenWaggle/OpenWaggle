import * as SqlClient from '@effect/sql/SqlClient'
import type { Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { registerAgentLoopInteractionDeadline } from '../application/agent-loop-interaction-broker'
import { executeAgentRun } from '../application/agent-run-service'
import { preserveOutcomeAfterAttachmentCleanup } from '../application/session-attachment-cleanup'
import { loadProjectConfig } from '../config/project-config'
import { resolveSessionHostProjectPolicy } from '../domain/session-control/session-host-policy'
import type { AgentKernelService } from '../ports/agent-kernel-service'
import { AgentRequestedWaggleService } from '../ports/agent-requested-waggle-service'
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
import { SessionOrchestrationUpdateRepository } from '../ports/session-orchestration-update-repository'
import type { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionReportRepository } from '../ports/session-report-repository'
import type { SessionRepository } from '../ports/session-repository'
import { SettingsService } from '../services/settings-service'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { startStreamBuffer } from '../utils/stream-bridge'
import {
  markOrchestrationUpdatesDelivered,
  markReportsDelivered,
  markSpecificationUpdatesDelivered,
} from './session-control-run-context-delivery'
import { loadRunExecutionProfile } from './session-control-run-executor-profile'
import { publishRunFailure, terminalRunResult } from './session-control-run-result'
import {
  narrowRunAuthorization,
  type ResolvedSessionRunExecution,
} from './session-run-execution-profile'
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
  readonly ownerCallerId: string
}) {
  return preserveOutcomeAfterAttachmentCleanup({
    effect: input.effect,
    cleanup: input.attachments.release({
      attachmentIds: input.attachmentIds,
      sessionId: input.sessionId,
      ownerCallerId: input.ownerCallerId,
    }),
    operation: 'run',
    sessionId: input.sessionId,
  })
}

function modelMultiAgentEnabled(settings: Settings, execution: ResolvedSessionRunExecution) {
  const projectPath = execution.projectPath
  if (!projectPath) return Effect.succeed(settings.multiAgentEnabled)
  return Effect.tryPromise({
    try: () => loadProjectConfig(projectPath),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  }).pipe(
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
  startStreamBuffer(input.request.sessionId, input.execution.model, 'classic')
  return input.request.intent.interactionTimeoutMs === undefined
    ? () => undefined
    : registerAgentLoopInteractionDeadline({
        runId: input.request.runId,
        timeoutMs: input.request.intent.interactionTimeoutMs,
        onTimeout: input.onInteractionTimeout,
      })
}

function executeRegisteredRun(input: {
  readonly request: SessionControlRunExecutionInput
  readonly execution: ResolvedSessionRunExecution
  readonly controller: AbortController
  readonly allowModelMultiAgent: boolean
}) {
  return Effect.gen(function* () {
    const attachments = yield* SessionControlAttachmentService
    const requestedWaggle = yield* AgentRequestedWaggleService
    const orchestrationUpdates = yield* SessionOrchestrationUpdateRepository
    const reports = yield* SessionReportRepository
    const pendingReports = yield* reports.listPending({ targetSessionId: input.request.sessionId })
    const pendingOrchestrationUpdates = yield* orchestrationUpdates.listPending({
      parentSessionId: input.request.sessionId,
    })
    const pendingSpecificationUpdates = yield* orchestrationUpdates.listPendingSpecifications({
      workerSessionId: input.request.sessionId,
    })
    const resolvedAttachments = yield* attachments.resolve({
      attachmentIds: input.request.intent.attachmentIds,
      sessionId: input.request.sessionId,
      ownerCallerId: input.request.intent.callerId,
    })
    const preparedAttachments = resolvedAttachments.map(
      ({ source: _source, ...attachment }) => attachment,
    )
    const result = yield* executeAgentRun({
      sessionId: input.request.sessionId,
      runId: input.request.runId,
      model: input.execution.model,
      payload: {
        text: input.request.intent.text,
        thinkingLevel: input.request.intent.thinkingLevel ?? input.execution.thinkingLevel,
        attachments: preparedAttachments,
      },
      hydratedAttachments: resolvedAttachments,
      runAuthorizationOverride: narrowRunAuthorization(
        input.request.intent.runAuthorizationOverride,
        input.execution.authorizationCeiling,
      ),
      authorityCallerId: input.request.intent.callerId,
      ...(input.execution.agentInstructions
        ? { agentInstructions: input.execution.agentInstructions }
        : {}),
      sessionIdentityContext: input.execution.identityContext,
      peerAgentReports: pendingReports,
      onPeerAgentReportsDelivered: (reportIds) => {
        markReportsDelivered(reports, input.request, reportIds)
      },
      orchestrationUpdates: pendingOrchestrationUpdates,
      onOrchestrationUpdatesDelivered: (updateIds) => {
        markOrchestrationUpdatesDelivered(orchestrationUpdates, input.request, updateIds)
      },
      delegationSpecificationUpdates: pendingSpecificationUpdates,
      onDelegationSpecificationUpdatesDelivered: (updateIds) => {
        markSpecificationUpdatesDelivered(orchestrationUpdates, input.request, updateIds)
      },
      ...(input.execution.toolAllowlist ? { toolAllowlist: input.execution.toolAllowlist } : {}),
      ...(input.execution.skillAllowlist ? { skillAllowlist: input.execution.skillAllowlist } : {}),
      ...(input.execution.mcpServerAllowlist
        ? { mcpServerAllowlist: input.execution.mcpServerAllowlist }
        : {}),
      sessionCapabilities: input.execution.sessionCapabilities,
      modelMultiAgentEnabled: input.allowModelMultiAgent,
      signal: input.controller.signal,
      onEvent: (event) => {
        publishSessionHostEvent({
          kind: 'session-transport',
          sessionId: input.request.sessionId,
          event,
        })
      },
      onTitleAssigned: () => {
        publishSessionHostEvent({
          kind: 'session-list-changed',
          sessionId: input.request.sessionId,
          change: 'updated',
        })
      },
    })
    if (
      result.outcome === 'invalid-model' ||
      result.outcome === 'not-found' ||
      result.outcome === 'error'
    ) {
      publishRunFailure(input.request, result)
    }
    if (result.outcome === 'success') {
      yield* requestedWaggle.runIfRequested({
        sessionId: input.request.sessionId,
        runId: input.request.runId,
        messages: result.newMessages,
        model: input.execution.model,
        thinkingLevel: input.request.intent.thinkingLevel ?? input.execution.thinkingLevel,
        controller: input.controller,
      })
    }
    return result
  })
}

function executeRun(input: SessionControlRunExecutionInput) {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService
    const sql = yield* SqlClient.SqlClient
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
    const attachments = yield* SessionControlAttachmentService
    const allowModelMultiAgent = yield* modelMultiAgentEnabled(
      yield* settingsService.get(),
      execution,
    )
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
    const result = yield* withRunAttachmentCleanup({
      effect: executeRegisteredRun({
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
      attachments,
      attachmentIds: input.intent.attachmentIds,
      sessionId: input.sessionId,
      ownerCallerId: input.intent.callerId,
    })
    return terminalRunResult(result, interactionTimedOut)
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
