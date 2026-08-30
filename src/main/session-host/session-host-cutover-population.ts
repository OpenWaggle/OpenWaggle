import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import {
  type AgentAuthorizationMode,
  isAgentAuthorizationMode,
} from '@shared/types/agent-authorization'
import { DEFAULT_SETTINGS, THINKING_LEVELS } from '@shared/types/settings'
import { sessionWorktreeBranchForId } from '@shared/utils/worktree'
import { resolveWorkspaceWorktreePath } from '../services/git/session-worktree-path'
import { sessionTranscriptSearchContentSql } from '../services/session-host-search-schema'
import {
  cutoverRecord,
  cutoverTableExists,
  queryCutoverRecord,
} from './session-host-cutover-database'

const RESOURCE_ID_DIGEST_CHARACTERS = 32
const CUTOVER_TRANSCRIPT_SEARCH_CONTENT = sessionTranscriptSearchContentSql('session_nodes')

interface LegacySessionRow {
  readonly id: string
  readonly project_path: string | null
  readonly environment_mode: string
  readonly worktree_path: string | null
  readonly worktree_base_ref: string | null
  readonly worktree_start_from_origin: number
  readonly authorization_mode_override: AgentAuthorizationMode | null
  readonly created_at: number
  readonly updated_at: number
}

interface LegacyActiveRunRow {
  readonly run_id: string
  readonly session_id: string
  readonly runtime_json: string
  readonly updated_at: number
}

function stableResourceId(kind: string, identity: string) {
  const digest = createHash('sha256')
    .update(`${kind}\0${identity}`)
    .digest('hex')
    .slice(0, RESOURCE_ID_DIGEST_CHARACTERS)
  return `workspace-${digest}`
}

function legacySetting(database: DatabaseSync, key: string): unknown {
  if (!cutoverTableExists(database, 'settings_store')) return undefined
  const valueJson = queryCutoverRecord(
    database,
    'SELECT value_json FROM settings_store WHERE key = ?',
    key,
  )?.value_json
  if (typeof valueJson !== 'string') return undefined
  try {
    const value: unknown = JSON.parse(valueJson)
    return value
  } catch {
    return undefined
  }
}

function legacyExecutionDefaults(database: DatabaseSync) {
  const selectedModel = legacySetting(database, 'selectedModel')
  const thinkingLevel = legacySetting(database, 'thinkingLevel')
  const defaultAuthorizationMode = legacySetting(database, 'defaultAuthorizationMode')
  const resolvedThinkingLevel = THINKING_LEVELS.find((candidate) => candidate === thinkingLevel)
  return {
    modelId:
      typeof selectedModel === 'string' && selectedModel.trim()
        ? selectedModel
        : String(DEFAULT_SETTINGS.selectedModel),
    thinkingLevel: resolvedThinkingLevel ?? DEFAULT_SETTINGS.thinkingLevel,
    authorizationCeiling: isAgentAuthorizationMode(defaultAuthorizationMode)
      ? defaultAuthorizationMode
      : DEFAULT_SETTINGS.defaultAuthorizationMode,
  }
}

const LEGACY_SESSION_COLUMN_NORMALIZATIONS = [
  ['environment_mode', "TEXT NOT NULL DEFAULT 'local'"],
  ['worktree_path', 'TEXT'],
  ['worktree_base_ref', 'TEXT'],
  ['worktree_start_from_origin', 'INTEGER NOT NULL DEFAULT 0'],
  ['authorization_mode_override', 'TEXT'],
] as const

/**
 * Normalizes the copied legacy database before the Session Host schema is layered onto it.
 *
 * The source database itself is never changed: cutover calls this only for its private staging
 * copy. Keeping the normalization here also lets users upgrade directly from any legacy Session
 * schema that predates the worktree or authorization columns instead of requiring intermediate
 * OpenWaggle releases to be installed first.
 */
export function normalizeLegacySessionColumns(database: DatabaseSync) {
  if (!cutoverTableExists(database, 'sessions')) return
  const columns = new Set(
    database
      .prepare('PRAGMA table_info(sessions)')
      .all()
      .flatMap((value) => {
        const row = cutoverRecord(value)
        return typeof row?.name === 'string' ? [row.name] : []
      }),
  )
  for (const [name, declaration] of LEGACY_SESSION_COLUMN_NORMALIZATIONS) {
    if (columns.has(name)) continue
    database.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${declaration}`)
  }
}

function workspaceForSession(session: LegacySessionRow) {
  if (session.environment_mode === 'worktree') {
    const projectPath = session.project_path ?? `unknown://project/${session.id}`
    const identity = session.worktree_path ?? `${projectPath}\0${session.id}`
    const id = stableResourceId('managed-worktree', identity)
    return {
      id,
      projectPath,
      kind: 'managed-worktree' as const,
      workingPath: session.worktree_path ?? resolveWorkspaceWorktreePath(projectPath, id),
      lifecycleState:
        session.project_path === null
          ? 'failed'
          : session.worktree_path
            ? existsSync(session.worktree_path)
              ? 'ready'
              : 'missing'
            : 'pending',
      worktreeBranch: session.worktree_path ? null : sessionWorktreeBranchForId(id),
    }
  }
  const localPath = session.project_path ?? `unknown://project/${session.id}`
  return {
    id: stableResourceId('local', localPath),
    projectPath: localPath,
    kind: 'local' as const,
    workingPath: localPath,
    lifecycleState: session.project_path && existsSync(session.project_path) ? 'ready' : 'missing',
    worktreeBranch: null,
  }
}

function requiredString(row: Record<string, unknown>, key: string) {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`Legacy row has invalid ${key}.`)
  return value
}

function nullableString(row: Record<string, unknown>, key: string) {
  const value = row[key]
  return value === null ? null : requiredString(row, key)
}

function requiredNumber(row: Record<string, unknown>, key: string) {
  const value = row[key]
  if (typeof value !== 'number') throw new Error(`Legacy row has invalid ${key}.`)
  return value
}

function decodeLegacySession(value: unknown): LegacySessionRow {
  const row = cutoverRecord(value)
  if (!row) throw new Error('Legacy Session row is invalid.')
  return {
    id: requiredString(row, 'id'),
    project_path: nullableString(row, 'project_path'),
    environment_mode: requiredString(row, 'environment_mode'),
    worktree_path: nullableString(row, 'worktree_path'),
    worktree_base_ref: nullableString(row, 'worktree_base_ref'),
    worktree_start_from_origin: requiredNumber(row, 'worktree_start_from_origin'),
    authorization_mode_override: (() => {
      const mode = nullableString(row, 'authorization_mode_override')
      if (mode !== null && !isAgentAuthorizationMode(mode)) {
        throw new Error('Legacy row has invalid authorization_mode_override.')
      }
      return mode
    })(),
    created_at: requiredNumber(row, 'created_at'),
    updated_at: requiredNumber(row, 'updated_at'),
  }
}

function decodeLegacyActiveRun(value: unknown): LegacyActiveRunRow {
  const row = cutoverRecord(value)
  if (!row) throw new Error('Legacy active Run row is invalid.')
  return {
    run_id: requiredString(row, 'run_id'),
    session_id: requiredString(row, 'session_id'),
    runtime_json: requiredString(row, 'runtime_json'),
    updated_at: requiredNumber(row, 'updated_at'),
  }
}

function readLegacyRows(database: DatabaseSync) {
  const sessionValues: unknown = database
    .prepare(`
    SELECT id, project_path, environment_mode, worktree_path, worktree_base_ref,
      worktree_start_from_origin, authorization_mode_override, created_at, updated_at
    FROM sessions ORDER BY id
  `)
    .all()
  const activeRunValues: unknown = database
    .prepare(`
    SELECT run_id, session_id, runtime_json, updated_at
    FROM session_active_runs ORDER BY run_id
  `)
    .all()
  if (!Array.isArray(sessionValues) || !Array.isArray(activeRunValues)) {
    throw new Error('Legacy Session rows could not be read.')
  }
  return {
    sessions: sessionValues.map(decodeLegacySession),
    activeRuns: activeRunValues.map(decodeLegacyActiveRun),
  }
}

export function populateSessionHostTarget(database: DatabaseSync, now: number) {
  const defaults = legacyExecutionDefaults(database)
  const { sessions, activeRuns } = readLegacyRows(database)
  const activeSessionIds = new Set(activeRuns.map((run) => run.session_id))
  const insertWorkspace = database.prepare(`
    INSERT OR IGNORE INTO workspace_resources (
      id, project_path, kind, working_path, lifecycle_state,
      worktree_branch, worktree_base_ref, worktree_start_from_origin, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertBinding = database.prepare(`
    INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at) VALUES (?, ?, ?)
  `)
  const insertExecutionProfile = database.prepare(`
    INSERT INTO session_execution_profiles (
      session_id, profile_json, authority_origin_caller_id,
      authorization_ceiling, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)
  const insertControlState = database.prepare(`
    INSERT INTO session_control_states (
      session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
    ) VALUES (?, 0, NULL, ?, 0, ?)
  `)
  const insertInterruptedRun = database.prepare(`
    INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
    VALUES (?, ?, 'interrupted-by-host-loss', ?, ?, ?)
  `)
  for (const session of sessions) {
    const workspace = workspaceForSession(session)
    insertWorkspace.run(
      workspace.id,
      workspace.projectPath,
      workspace.kind,
      workspace.workingPath,
      workspace.lifecycleState,
      workspace.worktreeBranch,
      session.worktree_base_ref,
      session.worktree_start_from_origin,
      session.created_at,
      session.updated_at,
    )
    insertBinding.run(session.id, workspace.id, now)
    insertExecutionProfile.run(
      session.id,
      JSON.stringify({ modelId: defaults.modelId, thinkingLevel: defaults.thinkingLevel }),
      'local-user:cutover',
      session.authorization_mode_override ?? defaults.authorizationCeiling,
      session.created_at,
      session.updated_at,
    )
    insertControlState.run(session.id, activeSessionIds.has(session.id) ? 'paused' : 'running', now)
  }
  for (const run of activeRuns) {
    const syntheticLegacyRuntime: unknown = JSON.parse(run.runtime_json)
    insertInterruptedRun.run(
      run.run_id,
      run.session_id,
      JSON.stringify({ syntheticLegacyRuntime }),
      run.updated_at,
      now,
    )
  }
  database.exec(`
    INSERT INTO session_title_search (session_id, title) SELECT id, title FROM sessions;
    INSERT INTO session_node_search (session_id, node_id, content)
    SELECT session_id, id, ${CUTOVER_TRANSCRIPT_SEARCH_CONTENT} FROM session_nodes;
    INSERT INTO session_node_discovery_search (session_id, node_id, content)
    SELECT session_id, id, COALESCE(
      (SELECT GROUP_CONCAT(
        CASE json_extract(part.value, '$.type')
          WHEN 'text' THEN json_extract(part.value, '$.text')
          WHEN 'attachment' THEN json_extract(part.value, '$.attachment.name')
          WHEN 'tool-call' THEN json_extract(part.value, '$.toolCall.name')
          WHEN 'tool-result' THEN json_extract(part.value, '$.toolResult.name')
          ELSE NULL
        END,
        ' '
      ) FROM json_each(session_nodes.content_json, '$.parts') AS part),
      json_extract(session_nodes.content_json, '$.text'),
      ''
    ) FROM session_nodes;
  `)
}
