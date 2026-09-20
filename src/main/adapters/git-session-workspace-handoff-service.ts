import * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import type { SessionHandoffWorkspaceSelection } from '@shared/types/session-organization'
import { isRecord } from '@shared/utils/validation'
import { sessionWorktreeBranchForId } from '@shared/utils/worktree'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  SessionWorkspaceHandoffService,
  type SessionWorkspaceHandoffServiceShape,
} from '../ports/session-workspace-handoff-service'
import { resolveWorkspaceWorktreePath } from '../services/git/session-worktree-path'
import {
  captureExistingWorkspaceSeeds,
  captureNewWorkspaceSeed,
  handoffPreparationError,
  preparedWorkspaceId,
} from './git/session-workspace-handoff-preparation'
import {
  applyWorkspaceHandoffSeed,
  assertWorkspaceMatchesHandoffSeed,
  releaseWorkspaceHandoffSeed,
  restoreWorkspaceHandoffSeed,
} from './git/workspace-handoff-snapshot'

interface SourceWorkspaceRow {
  readonly workspace_id: string
  readonly project_path: string
  readonly working_path: string
  readonly lifecycle_state: string
  readonly active_run_id: string | null
  readonly handoff_seed_ref: string | null
}

interface TargetWorkspaceRow {
  readonly id: string
  readonly project_path: string
  readonly working_path: string
  readonly lifecycle_state: string
  readonly handoff_seed_ref: string | null
}

interface ExistingOperationRow {
  readonly status: 'pending' | 'completed'
  readonly cleanup_json: string | null
}

type PrepareHandoffInput = Parameters<SessionWorkspaceHandoffServiceShape['prepare']>[0]

function loadSourceWorkspace(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<SourceWorkspaceRow>`
    SELECT
      workspace_resources.id AS workspace_id,
      workspace_resources.project_path,
      workspace_resources.working_path,
      workspace_resources.lifecycle_state,
      workspace_resources.handoff_seed_ref,
      session_control_states.active_run_id
    FROM session_workspace_bindings
    JOIN workspace_resources
      ON workspace_resources.id = session_workspace_bindings.workspace_id
    LEFT JOIN session_control_states
      ON session_control_states.session_id = session_workspace_bindings.session_id
    WHERE session_workspace_bindings.session_id = ${sessionId}
    LIMIT 1
  `
}

function loadTargetWorkspace(
  sql: SqlClient.SqlClient,
  input: {
    readonly projectPath: string
    readonly workspace: SessionHandoffWorkspaceSelection
  },
) {
  if (input.workspace.mode === 'local') {
    return sql<TargetWorkspaceRow>`
      SELECT id, project_path, working_path, lifecycle_state, handoff_seed_ref
      FROM workspace_resources
      WHERE project_path = ${input.projectPath}
        AND kind = ${'local'}
        AND working_path = ${input.projectPath}
      LIMIT 1
    `
  }
  if (input.workspace.mode === 'existing') {
    return sql<TargetWorkspaceRow>`
      SELECT id, project_path, working_path, lifecycle_state, handoff_seed_ref
      FROM workspace_resources
      WHERE id = ${input.workspace.workspaceId}
      LIMIT 1
    `
  }
  return Effect.succeed<readonly TargetWorkspaceRow[]>([])
}

function operationAlreadyExists(
  sql: SqlClient.SqlClient,
  input: { readonly callerId: string; readonly sessionId: string; readonly idempotencyKey: string },
) {
  return sql<ExistingOperationRow>`
    SELECT status, cleanup_json FROM session_operations
    WHERE caller_id = ${input.callerId}
      AND operation = ${'handoff'}
      AND target_scope = ${input.sessionId}
      AND idempotency_key = ${input.idempotencyKey}
    LIMIT 1
  `
}

function releaseCapturedExistingSeeds(
  projectPath: string,
  seeds: Awaited<ReturnType<typeof captureExistingWorkspaceSeeds>>,
) {
  return Promise.all([
    releaseWorkspaceHandoffSeed(projectPath, seeds.source.snapshotRef),
    releaseWorkspaceHandoffSeed(projectPath, seeds.target.snapshotRef),
  ]).then(() => undefined)
}

function prepareExistingTransfer(
  sql: SqlClient.SqlClient,
  input: PrepareHandoffInput,
  source: SourceWorkspaceRow,
  replay: ExistingOperationRow | undefined,
) {
  return Effect.gen(function* () {
    const targets = yield* loadTargetWorkspace(sql, {
      projectPath: source.project_path,
      workspace: input.request.command.workspace,
    })
    const target = targets[0]
    if (
      !target ||
      target.project_path !== source.project_path ||
      (target.lifecycle_state !== 'ready' &&
        !(replay?.status === 'pending' && target.lifecycle_state === 'materializing')) ||
      target.id === source.workspace_id
    ) {
      return undefined
    }
    const transferId = `${preparedWorkspaceId({
      callerId: input.callerId,
      sessionId: input.request.command.sessionId,
      idempotencyKey: input.request.idempotencyKey,
    })}-transfer`
    const seeds = yield* Effect.promise(() =>
      captureExistingWorkspaceSeeds({
        projectPath: source.project_path,
        sourceWorkingPath: source.working_path,
        targetWorkingPath: target.working_path,
        transferId,
      }),
    )
    if (replay?.status === 'pending' && target.handoff_seed_ref !== seeds.source.snapshotRef) {
      yield* Effect.promise(() => releaseCapturedExistingSeeds(source.project_path, seeds))
      return undefined
    }
    return {
      transfer: 'deferred-existing' as const,
      workspaceId: target.id,
      projectPath: source.project_path,
      sourceWorkingPath: source.working_path,
      workingPath: target.working_path,
      sourceHead: seeds.source.sourceHead,
      snapshotRef: seeds.source.snapshotRef,
      targetSnapshotRef: seeds.target.snapshotRef,
    }
  })
}

function prepareNewTransfer(input: PrepareHandoffInput, source: SourceWorkspaceRow) {
  const workspace = input.request.command.workspace
  if (workspace.mode !== 'new-worktree') return Effect.succeed(undefined)
  const workspaceId = preparedWorkspaceId({
    callerId: input.callerId,
    sessionId: input.request.command.sessionId,
    idempotencyKey: input.request.idempotencyKey,
  })
  return Effect.promise(() =>
    captureNewWorkspaceSeed({
      projectPath: source.project_path,
      workingPath: source.working_path,
      workspaceId,
      ...(workspace.baseRef ? { requestedBaseRef: workspace.baseRef } : {}),
    }),
  ).pipe(
    Effect.map((seed) => ({
      transfer: 'deferred-new-worktree' as const,
      workspaceId,
      projectPath: source.project_path,
      workingPath: resolveWorkspaceWorktreePath(source.project_path, workspaceId),
      worktreeBranch: sessionWorktreeBranchForId(workspaceId),
      sourceHead: seed.sourceHead,
      snapshotRef: seed.snapshotRef,
    })),
  )
}

function prepareWorkspaceHandoff(sql: SqlClient.SqlClient, input: PrepareHandoffInput) {
  return Effect.gen(function* () {
    const replay = (yield* operationAlreadyExists(sql, {
      callerId: input.callerId,
      sessionId: input.request.command.sessionId,
      idempotencyKey: input.request.idempotencyKey,
    }))[0]
    if (replay?.status === 'completed') {
      if (!replay.cleanup_json) return undefined
      const cleanup = parseJsonUnknown(replay.cleanup_json)
      if (
        isRecord(cleanup) &&
        cleanup.kind === 'workspace-handoff-refs' &&
        typeof cleanup.projectPath === 'string' &&
        typeof cleanup.snapshotRef === 'string' &&
        typeof cleanup.targetSnapshotRef === 'string'
      ) {
        return {
          transfer: 'release-existing-refs' as const,
          projectPath: cleanup.projectPath,
          snapshotRef: cleanup.snapshotRef,
          targetSnapshotRef: cleanup.targetSnapshotRef,
        }
      }
      throw new Error('Completed Workspace handoff has invalid cleanup metadata.')
    }
    const source = (yield* loadSourceWorkspace(sql, input.request.command.sessionId))[0]
    if (!source || source.active_run_id) return undefined
    if (source.lifecycle_state === 'pending') {
      return source.handoff_seed_ref
        ? {
            transfer: 'release-source' as const,
            workspaceId: source.workspace_id,
            projectPath: source.project_path,
            snapshotRef: source.handoff_seed_ref,
          }
        : undefined
    }
    if (source.lifecycle_state !== 'ready') return undefined
    return input.request.command.workspace.mode === 'new-worktree'
      ? yield* prepareNewTransfer(input, source)
      : yield* prepareExistingTransfer(sql, input, source, replay)
  })
}

export const GitSessionWorkspaceHandoffServiceLive = Layer.effect(
  SessionWorkspaceHandoffService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionWorkspaceHandoffService.of({
      prepare: (input) => prepareWorkspaceHandoff(sql, input),
      apply: (prepared) =>
        prepared.transfer !== 'deferred-existing'
          ? Effect.void
          : Effect.tryPromise({
              try: () =>
                assertWorkspaceMatchesHandoffSeed({
                  projectPath: prepared.projectPath,
                  workingPath: prepared.sourceWorkingPath,
                  snapshotRef: prepared.snapshotRef,
                }).then(() =>
                  applyWorkspaceHandoffSeed({
                    projectPath: prepared.projectPath,
                    workingPath: prepared.workingPath,
                    sourceHead: prepared.sourceHead,
                    snapshotRef: prepared.snapshotRef,
                  }),
                ),
              catch: (cause) => handoffPreparationError('workspace_target_transfer_failed', cause),
            }),
      rollback: (prepared) =>
        prepared.transfer !== 'deferred-existing'
          ? Effect.void
          : Effect.tryPromise(() =>
              restoreWorkspaceHandoffSeed({
                projectPath: prepared.projectPath,
                workingPath: prepared.workingPath,
                sourceHead: prepared.sourceHead,
                appliedSnapshotRef: prepared.snapshotRef,
                targetSnapshotRef: prepared.targetSnapshotRef,
              }),
            ),
      complete: (prepared, committed) =>
        prepared.transfer === 'deferred-existing' || prepared.transfer === 'release-existing-refs'
          ? Effect.promise(() =>
              Promise.all([
                releaseWorkspaceHandoffSeed(prepared.projectPath, prepared.snapshotRef),
                releaseWorkspaceHandoffSeed(prepared.projectPath, prepared.targetSnapshotRef),
              ]).then(() => undefined),
            ).pipe(Effect.asVoid)
          : prepared.transfer === 'release-source' || !committed
            ? Effect.promise(() =>
                releaseWorkspaceHandoffSeed(prepared.projectPath, prepared.snapshotRef),
              ).pipe(Effect.asVoid)
            : Effect.void,
    })
  }),
)
