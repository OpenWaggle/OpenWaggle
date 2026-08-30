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
import { assertSessionAuthoritySnapshot } from '../session-host/session-authority-snapshot'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { startStreamBuffer } from '../utils/stream-bridge'
import {
  markOrchestrationUpdatesDelivered,
  markReportsDelivered,
  markSpecificationUpdatesDelivered,
} from './session-control-run-context-delivery'
import { publishRunFailure, terminalRunResult } from './session-control-run-result'
import {
  narrowRunAuthorization,
  type ResolvedSessionRunExecution,
  resolveSessionRunExecution,
  type SessionRunExecutionProfileRow,
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

function loadExecutionProfile(
  sql: SqlClient.SqlClient,
  input: Pick<SessionControlRunExecutionInput, 'sessionId' | 'runId'>,
) {
  return Effect.gen(function* () {
    const rows = yield* sql<SessionRunExecutionProfileRow>`
      SELECT
        sessions.id AS session_id,
        sessions.title,
        sessions.project_path,
        session_execution_profiles.profile_json,
        session_execution_profiles.resolved_agent_snapshot_json,
        session_execution_profiles.authorization_ceiling,
        session_spawn_lineage.parent_session_id,
        parent_sessions.title AS parent_title,
        session_spawn_lineage.hive_root_session_id,
        session_spawn_lineage.depth,
        (SELECT COUNT(*) FROM session_spawn_lineage AS child_lineage
          WHERE child_lineage.parent_session_id = sessions.id) AS direct_worker_count,
        workspace_resources.id AS workspace_id,
        workspace_resources.kind AS workspace_kind,
        workspace_resources.working_path,
        derived_child_management_grants.capabilities_json,
        delegation_contracts.id AS delegation_id,
        delegation_contracts.state AS delegation_state
      FROM sessions
      JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
      JOIN session_workspace_bindings ON session_workspace_bindings.session_id = sessions.id
      JOIN workspace_resources ON workspace_resources.id = session_workspace_bindings.workspace_id
      LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
      LEFT JOIN sessions AS parent_sessions ON parent_sessions.id = session_spawn_lineage.parent_session_id
      LEFT JOIN derived_child_management_grants
        ON derived_child_management_grants.child_session_id = sessions.id
        AND derived_child_management_grants.revoked_at IS NULL
      LEFT JOIN delegation_contracts ON delegation_contracts.child_session_id = sessions.id
      WHERE sessions.id = ${input.sessionId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) {
      return yield* Effect.fail(
        new Error(`Session ${input.sessionId} has no durable execution profile or Workspace.`),
      )
    }
    return yield* Effect.try({
      try: () => resolveSessionRunExecution(row, input.runId),
      catch: (cause) =>
        new Error(`Session ${input.sessionId} has an invalid durable execution profile.`, {
          cause,
        }),
    })
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
    const execution = yield* loadExecutionProfile(sql, input)
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
          void assertSessionAuthoritySnapshot(authoritySnapshot)
            .catch(() => {
              input.controller.abort(
                new Error('Run interrupted because its filesystem authority changed.'),
              )
            })
            .finally(() => {
              checkingAuthority = false
            })
        }, 100)
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
