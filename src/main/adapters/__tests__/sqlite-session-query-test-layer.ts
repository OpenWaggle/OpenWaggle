import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SessionQuery } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { SESSION_HOST_TARGET_SCHEMA_STATEMENTS } from '../../services/session-host-target-schema'
import type { SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { makeSqliteSessionQueryRepositoryLive } from '../sqlite-session-query-repository'

function makeLayer(filename: string, model?: SessionEmbeddingModel) {
  const sqlite = SqliteClient.layer({ filename, prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          pi_session_id TEXT NOT NULL UNIQUE,
          project_path TEXT,
          title TEXT NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_active_branch_id TEXT
        )
      `)
      yield* sql.unsafe(`
        CREATE TABLE session_nodes (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          parent_id TEXT,
          kind TEXT NOT NULL,
          role TEXT,
          timestamp_ms INTEGER NOT NULL,
          content_json TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          branch_hint_id TEXT,
          created_order INTEGER NOT NULL
        )
      `)
      yield* sql.unsafe(`
        CREATE TABLE session_branches (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          head_node_id TEXT
        )
      `)
      for (const statement of SESSION_HOST_TARGET_SCHEMA_STATEMENTS) {
        yield* sql.unsafe(statement)
      }
      for (const session of [
        { id: 'queen', pi: 'pi-queen', title: 'Architecture hive', project: '/project-a', at: 3 },
        { id: 'worker', pi: 'pi-worker', title: 'Protocol worker', project: '/project-a', at: 2 },
        { id: 'other', pi: 'pi-other', title: 'Private other', project: '/project-b', at: 1 },
      ]) {
        const workspaceId = session.project === '/project-a' ? 'workspace-a' : 'workspace-b'
        yield* sql`
          INSERT INTO sessions (id, pi_session_id, project_path, title, created_at, updated_at)
          VALUES (${session.id}, ${session.pi}, ${session.project}, ${session.title}, ${1}, ${session.at})
        `
        yield* sql`
          INSERT OR IGNORE INTO workspace_resources (
            id, project_path, kind, working_path, lifecycle_state, created_at, updated_at
          ) VALUES (
            ${workspaceId}, ${session.project}, ${'local'}, ${session.project},
            ${'ready'}, ${1}, ${1}
          )
        `
        yield* sql`
          INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
          VALUES (${session.id}, ${workspaceId}, ${1})
        `
        yield* sql`
          INSERT INTO session_execution_profiles (
            session_id, profile_json, authority_origin_caller_id,
            authorization_ceiling, created_at, updated_at
          ) VALUES (
            ${session.id}, ${session.id === 'worker' ? '{"agentDefinitionName":"reviewer"}' : '{}'},
            ${'local-user:test'}, ${'ask-for-approval'}, ${1}, ${1}
          )
        `
        yield* sql`
          INSERT INTO session_control_states (
            session_id, state_revision, queue_state, queue_revision, updated_at
          ) VALUES (${session.id}, ${0}, ${'running'}, ${0}, ${1})
        `
      }
      yield* sql`
        INSERT INTO session_runs (id, session_id, status, created_at, updated_at)
        VALUES (${'run-queen'}, ${'queen'}, ${'active'}, ${1}, ${1})
      `
      yield* sql`
        INSERT INTO session_runs (id, session_id, status, created_at, updated_at)
        VALUES
          (${'run-worker'}, ${'worker'}, ${'completed'}, ${2}, ${3}),
          (${'run-worker-2'}, ${'worker'}, ${'interrupted'}, ${1}, ${2})
      `
      yield* sql`
        INSERT INTO session_spawn_lineage (
          child_session_id, parent_session_id, parent_run_id,
          hive_root_session_id, depth, created_at
        ) VALUES (${'worker'}, ${'queen'}, ${'run-queen'}, ${'queen'}, ${1}, ${1})
      `
      yield* sql`
        INSERT INTO delegation_contracts (
          id, parent_session_id, child_session_id, state,
          current_specification_revision, created_at, updated_at
        ) VALUES (
          ${'delegation-worker'}, ${'queen'}, ${'worker'}, ${'ready_for_review'},
          ${1}, ${1}, ${2}
        )
      `
      yield* sql`
        INSERT INTO delegation_specifications (
          delegation_id, revision, specification_json, authored_by, created_at
        ) VALUES (
          ${'delegation-worker'}, ${1},
          ${'{"objective":"Validate migration","deliverables":[],"acceptanceCriteria":[],"resourceReferences":[]}'},
          ${'queen'}, ${1}
        )
      `
      yield* sql`
        INSERT INTO delegation_submissions (
          delegation_id, revision, specification_revision, summary, submitted_by,
          provenance, created_at
        ) VALUES (
          ${'delegation-worker'}, ${1}, ${1}, ${'Migration is ready.'},
          ${'worker'}, ${'agent-submitted'}, ${2}
        )
      `
      yield* sql`
        INSERT INTO delegation_evidence (
          delegation_id, submission_revision, ordinal, kind, summary, created_at
        ) VALUES (
          ${'delegation-worker'}, ${1}, ${0}, ${'observed-command'}, ${'Tests passed.'}, ${2}
        )
      `
      yield* sql`
        INSERT INTO delegation_claim_revisions (
          delegation_id, revision, actor_session_id, authored_by, reason, created_at
        ) VALUES (
          ${'delegation-worker'}, ${1}, ${'worker'}, ${'worker'},
          ${'Editing the migration.'}, ${2}
        )
      `
      yield* sql`
        INSERT INTO delegation_scope_claims (
          delegation_id, revision, ordinal, access, target_kind, target_value, created_at
        ) VALUES (
          ${'delegation-worker'}, ${1}, ${0}, ${'write'},
          ${'workspace-tree'}, ${'src/main'}, ${2}
        )
      `
      yield* sql`
        INSERT INTO delegation_undeclared_writes (
          id, delegation_id, worker_session_id, run_id, path,
          claim_revision, provenance, created_at
        ) VALUES (
          ${'undeclared-worker-1'}, ${'delegation-worker'}, ${'worker'}, ${'run-worker'},
          ${'website/package.json'}, ${1}, ${'isolated-turn-checkpoint'}, ${2}
        )
      `
      yield* sql`
        INSERT INTO session_nodes (
          id, session_id, kind, role, timestamp_ms, content_json,
          metadata_json, branch_hint_id, created_order
        ) VALUES (
          ${'node-worker-1'}, ${'worker'}, ${'message'}, ${'assistant'}, ${1},
          ${'{"text":"neural handshake verifier"}'},
          ${'{"openWaggle":{"runId":"run-worker"}}'}, ${'worker:branch:main'}, ${0}
        )
      `
      yield* sql`
        INSERT INTO session_nodes (
          id, session_id, parent_id, kind, role, timestamp_ms, content_json,
          metadata_json, branch_hint_id, created_order
        ) VALUES (
          ${'node-worker-2'}, ${'worker'}, ${'node-worker-1'}, ${'message'}, ${'assistant'}, ${2},
          ${'{"parts":[{"type":"text","text":"second page"},{"type":"reasoning","text":"private chain marker"},{"type":"tool-call","toolCall":{"name":"write_file","args":{"token":"private tool marker"}}}]}'},
          ${'{"openWaggle":{"runId":"run-worker-2"}}'}, ${'worker:branch:main'}, ${1}
        )
      `
      yield* sql`
        INSERT INTO session_branches (id, session_id, head_node_id)
        VALUES (${'worker:branch:main'}, ${'worker'}, ${'node-worker-2'})
      `
      yield* sql`
        UPDATE sessions SET last_active_branch_id = ${'worker:branch:main'}
        WHERE id = ${'worker'}
      `
      yield* sql`
        INSERT INTO session_follow_ups (
          id, session_id, position, delivery_state, intent_json, created_at, updated_at
        ) VALUES (
          ${'follow-up-1'}, ${'worker'}, ${0}, ${'pending'}, ${'{"text":"next"}'}, ${1}, ${1}
        )
      `
    }).pipe(Effect.provide(sqlite)),
  )
  return Layer.mergeAll(
    sqlite,
    schema,
    makeSqliteSessionQueryRepositoryLive(model).pipe(Layer.provide(sqlite)),
  )
}

export function makeSessionQueryRuntime(filename: string, model?: SessionEmbeddingModel) {
  return ManagedRuntime.make(makeLayer(filename, model))
}

export function executeSessionQuery(
  runtime: ReturnType<typeof makeSessionQueryRuntime>,
  query: SessionQuery,
  authority?: LocalSessionProfileAuthority,
  callerId?: string,
) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const repository = yield* SessionQueryRepository
      return yield* repository.execute({
        ...(callerId ? { callerId } : {}),
        ...(authority ? { authority } : {}),
        request: { contractVersion: 2, requestId: 'query', query },
      })
    }),
  )
}
