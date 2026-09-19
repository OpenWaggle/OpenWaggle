import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  AgentKernelService,
  type AgentKernelServiceShape,
  type CreateAgentKernelSessionInput,
  type ForkAgentKernelSessionInput,
} from '../../ports/agent-kernel-service'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { SettingsService } from '../../services/settings-service'
import { SessionLifecyclePreparationServiceLive } from '../session-lifecycle-preparation-service'

export function makeLifecyclePreparationLayer(
  filename: string,
  createdProjects: string[],
  projectPath = '/project',
) {
  const sqlite = SqliteClient.layer({ filename, prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          project_path TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT 'Session',
          pi_session_id TEXT NOT NULL DEFAULT 'pi-source',
          pi_session_file TEXT,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL DEFAULT 1,
          environment_mode TEXT NOT NULL DEFAULT 'local',
          worktree_path TEXT,
          worktree_base_ref TEXT,
          worktree_start_from_origin INTEGER NOT NULL DEFAULT 0,
          authorization_mode_override TEXT,
          last_active_node_id TEXT
        )
      `)
      yield* sql.unsafe(`
        CREATE TABLE workspace_resources (
          id TEXT PRIMARY KEY,
          project_path TEXT NOT NULL,
          kind TEXT NOT NULL,
          working_path TEXT NOT NULL
        )
      `)
      yield* sql.unsafe(`
        CREATE TABLE session_execution_profiles (
          session_id TEXT PRIMARY KEY,
          profile_json TEXT NOT NULL,
          resolved_agent_snapshot_json TEXT,
          authority_origin_caller_id TEXT NOT NULL DEFAULT 'local-user',
          authority_scope_snapshot_json TEXT,
          authorization_ceiling TEXT NOT NULL
        )
      `)
      yield* sql.unsafe(`
        CREATE TABLE session_lifecycle_preparation_attempts (
          attempt_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          pi_session_file TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)
      yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'session-parent'}, ${projectPath})`
      yield* sql`
        INSERT INTO session_execution_profiles (
          session_id, profile_json, resolved_agent_snapshot_json, authorization_ceiling
        ) VALUES (
          ${'session-parent'},
          ${'{"modelId":"provider/parent","thinkingLevel":"high"}'},
          ${null},
          ${'yolo'}
        )
      `
    }).pipe(Effect.provide(sqlite)),
  )
  const dependencies = Layer.mergeAll(
    Layer.succeed(
      AgentKernelService,
      fromPartial<AgentKernelServiceShape>({
        createSession: ({ projectPath }: CreateAgentKernelSessionInput) =>
          Effect.sync(() => {
            createdProjects.push(projectPath)
            return { piSessionId: `pi-${createdProjects.length}` }
          }),
        forkSession: (input: ForkAgentKernelSessionInput) =>
          Effect.succeed({
            cancelled: false,
            piSessionId: 'pi-forked',
            piSessionFile: '/tmp/pi-forked.jsonl',
            sessionSnapshot: {
              nodes: [
                {
                  id: 'fork-node',
                  parentId: null,
                  piEntryType: 'message',
                  kind: 'user_message',
                  role: 'user',
                  timestampMs: 1,
                  contentJson: '{}',
                  metadataJson: '{}',
                  pathDepth: 0,
                  createdOrder: 0,
                },
              ],
              activeNodeId: 'fork-node',
            },
            editorText: input.position === 'before' ? 'Retry this' : undefined,
          }),
      }),
    ),
    Layer.succeed(SettingsService, {
      get: () =>
        Effect.succeed({
          ...DEFAULT_SETTINGS,
          selectedModel: SupportedModelId('provider/model'),
          sessionHostParentConcurrencyLimitsByProject: { [projectPath]: 9 },
        }),
      update: () => Effect.void,
      initialize: () => Effect.void,
      flushForTests: () => Effect.void,
    }),
  )
  return Layer.mergeAll(
    sqlite,
    schema,
    dependencies,
    SessionLifecyclePreparationServiceLive.pipe(
      Layer.provide(Layer.mergeAll(sqlite, dependencies)),
    ),
  )
}
