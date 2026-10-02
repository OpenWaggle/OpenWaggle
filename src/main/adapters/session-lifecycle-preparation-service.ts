import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { agentDefinitionTogglesForProject } from '../agents/agent-definition-toggle-settings'
import { loadProjectConfigStrict } from '../config/project-config'
import { resolveSessionHostProjectPolicy } from '../domain/session-control/session-host-policy'
import { SessionLifecyclePreparationError } from '../errors'
import { AgentKernelService } from '../ports/agent-kernel-service'
import {
  type PreparedSessionLifecycleAttempt,
  type PrepareSessionLifecycleInput,
  SessionLifecyclePreparationService,
} from '../ports/session-lifecycle-preparation-service'
import {
  ThinkingLevelDefaultService,
  type ThinkingLevelDefaultServiceShape,
} from '../ports/thinking-level-default-service'
import { SettingsService } from '../services/settings-service'
import {
  buildLifecycleExecutionProfile,
  deriveChildCapabilities,
  reduceAuthorizationCeiling,
  resolveLifecycleExecutionContext,
  resolveLifecycleSessionCapabilities,
} from './session-lifecycle-execution-profile'
import { prepareLifecycleFork } from './session-lifecycle-fork-preparation'
import {
  prepareLifecycleWorkspacePlan,
  projectPathForLifecycleCommand,
} from './session-lifecycle-workspace-plan'

/** Launch and spawn start a Run at once, so they cannot proceed without a model. */
function requireRunModel(
  command: PrepareSessionLifecycleInput['request']['command'],
  modelId: string,
) {
  const startsRun = command.operation === 'launch' || command.operation === 'spawn'
  if (!startsRun || modelId.trim().length > 0) return Effect.void
  return Effect.fail(
    preparationError(
      'resolve-model',
      new Error(
        'No model is selected. Pass --model <provider/model>, or choose a model in the OpenWaggle desktop app.',
      ),
    ),
  )
}

function preparationError(operation: string, cause: unknown) {
  return new SessionLifecyclePreparationError({ operation, cause })
}

function deletePreparationAttempt(sql: SqlClient.SqlClient, attemptId: string) {
  return sql`DELETE FROM session_lifecycle_preparation_attempts WHERE attempt_id = ${attemptId}`.pipe(
    Effect.asVoid,
  )
}

function recordPreparationAttempt(
  sql: SqlClient.SqlClient,
  input: { readonly attemptId: string; readonly sessionId: string; readonly createdAt: number },
) {
  return sql`
    INSERT INTO session_lifecycle_preparation_attempts (
      attempt_id, session_id, pi_session_file, created_at, updated_at
    ) VALUES (
      ${input.attemptId}, ${input.sessionId}, ${null}, ${input.createdAt}, ${input.createdAt}
    )
  `
}

function recordPreparedSessionFile(
  sql: SqlClient.SqlClient,
  attemptId: string,
  piSessionFile: string | undefined,
) {
  return sql`
    UPDATE session_lifecycle_preparation_attempts
    SET pi_session_file = ${piSessionFile ?? null}, updated_at = ${Date.now()}
    WHERE attempt_id = ${attemptId}
  `
}

function cleanupFailedPreparation(
  sql: SqlClient.SqlClient,
  attemptId: string,
  piSessionFile: string | undefined,
) {
  if (!piSessionFile) return deletePreparationAttempt(sql, attemptId)
  return Effect.promise(() => rm(piSessionFile, { force: true })).pipe(
    Effect.flatMap(() => deletePreparationAttempt(sql, attemptId)),
    Effect.catchAll(() =>
      sql`
        UPDATE session_lifecycle_preparation_attempts
        SET pi_session_file = ${piSessionFile}, updated_at = ${Date.now()}
        WHERE attempt_id = ${attemptId}
      `.pipe(
        Effect.asVoid,
        Effect.catchAll(() => Effect.void),
      ),
    ),
  )
}

function discardAttempt(sql: SqlClient.SqlClient, attempt: PreparedSessionLifecycleAttempt) {
  return Effect.gen(function* () {
    const file = attempt.session.piSessionFile
    if (file) yield* Effect.promise(() => rm(file, { force: true }))
    yield* deletePreparationAttempt(sql, attempt.attemptId)
  })
}

function recoverPendingAttempts(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const rows = yield* sql<{
      readonly attempt_id: string
      readonly committed_session_id: string | null
      readonly pi_session_file: string | null
    }>`
      SELECT attempts.attempt_id, attempts.pi_session_file,
        sessions.id AS committed_session_id
      FROM session_lifecycle_preparation_attempts AS attempts
      LEFT JOIN sessions ON sessions.id = attempts.session_id
      ORDER BY attempts.created_at
    `
    for (const row of rows) {
      const file = row.pi_session_file
      if (file && row.committed_session_id === null) {
        yield* Effect.promise(() => rm(file, { force: true }))
      }
      yield* deletePreparationAttempt(sql, row.attempt_id)
    }
  })
}

function forkAttemptFields(
  forked:
    | {
        readonly result: {
          readonly sessionSnapshot: NonNullable<PreparedSessionLifecycleAttempt['forkSnapshot']>
          readonly editorText?: string
        }
        readonly targetNodeId: string
      }
    | undefined,
) {
  if (!forked) return {}
  return {
    forkSnapshot: forked.result.sessionSnapshot,
    ...(forked.result.editorText ? { forkEditorText: forked.result.editorText } : {}),
    forkSourceNodeId: forked.targetNodeId,
  }
}

function lifecycleAgentToggles(
  byProject: Parameters<typeof agentDefinitionTogglesForProject>[0],
  projectPath: string,
) {
  return Effect.promise(() => agentDefinitionTogglesForProject(byProject, projectPath))
}

function loadLifecyclePolicy(
  settings: Parameters<typeof resolveSessionHostProjectPolicy>[0],
  projectPath: string,
) {
  return Effect.tryPromise({
    try: () => loadProjectConfigStrict(projectPath),
    catch: (cause) =>
      new SessionLifecyclePreparationError({
        operation: 'load-project-session-host-policy',
        cause,
      }),
  }).pipe(
    Effect.map((projectConfig) =>
      resolveSessionHostProjectPolicy(settings, projectPath, projectConfig.sessionHost),
    ),
  )
}

/** A new Session starts from Pi's default thinking level, like Pi's own sessions. */
function defaultThinkingLevel(defaults: ThinkingLevelDefaultServiceShape, projectPath: string) {
  return defaults
    .getDefault(projectPath)
    .pipe(
      Effect.mapError(
        (cause) =>
          new SessionLifecyclePreparationError({ operation: 'read-default-thinking-level', cause }),
      ),
    )
}

export const SessionLifecyclePreparationServiceLive = Layer.effect(
  SessionLifecyclePreparationService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const kernel = yield* AgentKernelService
    const settingsService = yield* SettingsService
    const thinkingLevelDefaults = yield* ThinkingLevelDefaultService
    return SessionLifecyclePreparationService.of({
      prepare: (input) =>
        Effect.suspend(() => {
          const attemptId = randomUUID()
          let piSessionFile: string | undefined
          return Effect.gen(function* () {
            const attemptCreatedAt = Date.now()
            yield* recordPreparationAttempt(sql, {
              attemptId,
              sessionId: input.identities.sessionId,
              createdAt: attemptCreatedAt,
            })
            const projectPath = yield* projectPathForLifecycleCommand(sql, input.request.command)
            const settings = yield* settingsService.get()
            const policy = yield* loadLifecyclePolicy(settings, projectPath)
            const { parent, definition } = yield* resolveLifecycleExecutionContext(
              sql,
              projectPath,
              input.request.command,
              input.callerId,
              yield* lifecycleAgentToggles(settings.agentDefinitionTogglesByProject, projectPath),
            )
            const plan = yield* prepareLifecycleWorkspacePlan(sql, input, projectPath, definition)
            const command = input.request.command
            const profile = buildLifecycleExecutionProfile({
              command,
              defaults: {
                selectedModel: settings.selectedModel,
                thinkingLevel: yield* defaultThinkingLevel(thinkingLevelDefaults, projectPath),
              },
              parent,
              definition,
            })
            yield* requireRunModel(command, profile.modelId)
            const forked =
              command.operation === 'fork'
                ? yield* prepareLifecycleFork({
                    sql,
                    kernel,
                    command,
                    modelId: parent?.profile.modelId ?? settings.selectedModel,
                  })
                : undefined
            const piSession = forked?.result ?? (yield* kernel.createSession({ projectPath }))
            piSessionFile = piSession.piSessionFile
            yield* recordPreparedSessionFile(sql, attemptId, piSession.piSessionFile)
            const derivedCapabilities = deriveChildCapabilities(input, profile)
            const sessionCapabilities = resolveLifecycleSessionCapabilities({
              command,
              profile,
              ...(input.callerCapabilities ? { callerCapabilities: input.callerCapabilities } : {}),
            })
            return {
              attemptId,
              session: {
                sessionId: input.identities.sessionId,
                piSessionId: piSession.piSessionId,
                ...(piSession.piSessionFile ? { piSessionFile: piSession.piSessionFile } : {}),
              },
              workspacePlan: plan,
              executionSnapshot: {
                profile: {
                  ...profile,
                  ...(sessionCapabilities ? { sessionCapabilities } : {}),
                },
                ...(definition ? { resolvedAgentSnapshot: definition } : {}),
                authorizationCeiling: reduceAuthorizationCeiling(
                  'yolo',
                  input.callerAuthorizationCeiling,
                  parent?.authorizationCeiling,
                  definition?.authorizationMode,
                ),
              },
              ...(derivedCapabilities ? { derivedCapabilities } : {}),
              parentConcurrencyLimit: policy.parentConcurrencyLimit,
              hostRunCeiling: policy.hostRunCeiling,
              ...forkAttemptFields(forked),
            } satisfies PreparedSessionLifecycleAttempt
          }).pipe(
            Effect.onExit((exit) =>
              exit._tag === 'Success'
                ? Effect.void
                : cleanupFailedPreparation(sql, attemptId, piSessionFile).pipe(
                    Effect.catchAll(() => Effect.void),
                  ),
            ),
          )
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof SessionLifecyclePreparationError
              ? cause
              : preparationError('prepare-session-lifecycle', cause),
          ),
        ),
      discard: ({ attempt }) =>
        discardAttempt(sql, attempt).pipe(
          Effect.mapError((cause) => preparationError('discard-session-lifecycle-attempt', cause)),
        ),
      commit: ({ attempt }) =>
        deletePreparationAttempt(sql, attempt.attemptId).pipe(
          Effect.mapError((cause) => preparationError('commit-session-lifecycle-attempt', cause)),
        ),
      recoverPending: recoverPendingAttempts(sql).pipe(
        Effect.mapError((cause) => preparationError('recover-session-lifecycle-attempts', cause)),
      ),
    })
  }),
)
