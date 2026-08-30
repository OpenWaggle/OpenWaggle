import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { SESSION_LIFECYCLE_CONTRACT_VERSION } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { CURRENT_SESSION_SCHEMA_STATEMENTS } from '../../services/database-schema'
import { SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS } from '../../services/session-host-target-schema'
import { SqliteSessionDelegationRepositoryLive } from '../sqlite-session-delegation-repository'
import { SqliteSessionLifecycleRepositoryLive } from '../sqlite-session-lifecycle-repository'
import { SqliteSessionReportRepositoryLive } from '../sqlite-session-report-repository'

const DEFAULT_PARENT_CONCURRENCY_LIMIT = 4
const DEFAULT_HOST_RUN_CEILING = 16

export function makeSessionLifecycleTestLayer(filename: string) {
  const sqlite = SqliteClient.layer({ filename, prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, pi_session_id TEXT NOT NULL UNIQUE, pi_session_file TEXT,
          project_path TEXT, title TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
          waggle_config_json TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          last_active_node_id TEXT, last_active_branch_id TEXT,
          environment_mode TEXT NOT NULL DEFAULT 'local', worktree_path TEXT,
          worktree_base_ref TEXT, worktree_start_from_origin INTEGER NOT NULL DEFAULT 0,
          authorization_mode_override TEXT
        )
      `)
      for (const statement of CURRENT_SESSION_SCHEMA_STATEMENTS) {
        yield* sql.unsafe(statement)
      }
      for (const statement of SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS) {
        yield* sql.unsafe(statement)
      }
      yield* sql`
        INSERT INTO sessions (
          id, pi_session_id, project_path, title, archived, created_at, updated_at
        ) VALUES (
          ${'session-parent'}, ${'pi-parent'}, ${'/project'}, ${'Parent'}, ${0}, ${1}, ${1}
        )
      `
      yield* sql`
        INSERT INTO workspace_resources (
          id, project_path, kind, working_path, lifecycle_state,
          worktree_start_from_origin, created_at, updated_at
        ) VALUES (
          ${'workspace-parent'}, ${'/project'}, ${'local'}, ${'/project'}, ${'ready'},
          ${0}, ${1}, ${1}
        )
      `
      yield* sql`
        INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
        VALUES (${'session-parent'}, ${'workspace-parent'}, ${1})
      `
      yield* sql`
        INSERT INTO session_execution_profiles (
          session_id, profile_json, authority_origin_caller_id,
          authorization_ceiling, created_at, updated_at
        ) VALUES (
          ${'session-parent'}, ${JSON.stringify({ modelId: 'provider/model' })},
          ${'local-user'}, ${'ask-for-approval'}, ${1}, ${1}
        )
      `
      yield* sql`
        INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
        VALUES (${'run-parent'}, ${'session-parent'}, ${'active'}, ${null}, ${1}, ${1})
      `
      yield* sql`
        INSERT INTO session_control_states (
          session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
        ) VALUES (${'session-parent'}, ${1}, ${'run-parent'}, ${'running'}, ${0}, ${1})
      `
    }).pipe(Effect.provide(sqlite)),
  )
  return Layer.mergeAll(
    sqlite,
    schema,
    SqliteSessionLifecycleRepositoryLive.pipe(Layer.provide(sqlite)),
    SqliteSessionReportRepositoryLive.pipe(Layer.provide(sqlite)),
    SqliteSessionDelegationRepositoryLive.pipe(Layer.provide(sqlite)),
  )
}

const spawnRequest = {
  contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
  requestId: 'request-spawn',
  idempotencyKey: 'idempotency-spawn',
  command: {
    operation: 'spawn',
    parentSessionId: 'session-parent',
    expectedParentRunId: 'run-parent',
    workspace: { mode: 'share-parent' },
    delegation: {
      objective: 'Implement the verifier.',
      deliverables: ['Implementation', 'Tests'],
      acceptanceCriteria: ['Corrupt targets fail'],
      dependencies: [],
      resourceReferences: [],
    },
  },
} as const

export function spawnLifecycleInput(parentConcurrencyLimit = DEFAULT_PARENT_CONCURRENCY_LIMIT) {
  return {
    callerId: 'local-user',
    request: spawnRequest,
    session: {
      sessionId: 'session-worker',
      piSessionId: 'pi-worker',
      piSessionFile: '/sessions/worker.jsonl',
    },
    runId: 'run-worker',
    delegationId: 'delegation-worker',
    derivedGrantId: 'grant-worker',
    workspacePlan: { mode: 'parent' as const },
    executionSnapshot: {
      profile: { modelId: 'provider/model', thinkingLevel: 'high' },
      authorizationCeiling: 'ask-for-approval' as const,
    },
    derivedCapabilities: ['sessions:message', 'sessions:interrupt', 'delegations:review'],
    parentConcurrencyLimit,
    hostRunCeiling: DEFAULT_HOST_RUN_CEILING,
    now: 2000,
  }
}

export function rootLifecycleInput(operation: 'create' | 'launch') {
  const request =
    operation === 'create'
      ? {
          contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
          requestId: 'request-create',
          idempotencyKey: 'idempotency-create',
          command: {
            operation: 'create' as const,
            projectPath: '/project',
            title: 'Idle root',
            workspace: { mode: 'local' as const },
          },
        }
      : {
          contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
          requestId: 'request-launch',
          idempotencyKey: 'idempotency-launch',
          command: {
            operation: 'launch' as const,
            projectPath: '/project',
            title: 'Running root',
            workspace: { mode: 'existing' as const, workspaceId: 'workspace-parent' },
            objective: 'Audit the target schema.',
            attachmentIds: ['attachment-schema'],
          },
        }
  return {
    callerId: 'local-user',
    request,
    session: {
      sessionId: `session-${operation}`,
      piSessionId: `pi-${operation}`,
      piSessionFile: `/sessions/${operation}.jsonl`,
    },
    ...(operation === 'launch' ? { runId: 'run-launch' } : {}),
    workspacePlan: { mode: 'existing' as const, workspaceId: 'workspace-parent' },
    executionSnapshot: {
      profile: { modelId: 'provider/model', thinkingLevel: 'high' },
      authorizationCeiling: 'ask-for-approval' as const,
    },
    now: 3000,
  }
}

export function forkLifecycleInput() {
  return {
    callerId: 'local-user',
    request: {
      contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
      requestId: 'request-fork',
      idempotencyKey: 'idempotency-fork',
      command: {
        operation: 'fork' as const,
        sourceSessionId: 'session-parent',
        targetNodeId: 'source-node',
        position: 'at' as const,
        title: 'Forked session',
        workspace: { mode: 'share-source' as const },
      },
    },
    session: {
      sessionId: 'session-fork',
      piSessionId: 'pi-fork',
      piSessionFile: '/sessions/fork.jsonl',
    },
    workspacePlan: { mode: 'parent' as const },
    executionSnapshot: {
      profile: { modelId: 'provider/model', thinkingLevel: 'high' },
      authorizationCeiling: 'ask-for-approval' as const,
    },
    forkSnapshot: {
      nodes: [
        {
          id: 'fork-node',
          parentId: null,
          piEntryType: 'message',
          kind: 'user_message' as const,
          role: 'user' as const,
          timestampMs: 10,
          contentJson: JSON.stringify({ text: 'Fork this conversation.' }),
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: 0,
        },
      ],
      activeNodeId: 'fork-node',
    },
    forkSourceNodeId: 'source-node',
    now: 4000,
  }
}
