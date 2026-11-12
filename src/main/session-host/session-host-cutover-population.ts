import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { Schema, type SchemaType, safeDecodeUnknown } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import { DEFAULT_SETTINGS, DEFAULT_THINKING_LEVEL, THINKING_LEVELS } from '@shared/types/settings'
import { sessionWorktreeBranchForId } from '@shared/utils/worktree'
import { resolveWorkspaceWorktreePath } from '../services/git/session-worktree-path'
import type { HostSqliteDatabase } from './host-sqlite-database'
import {
  cutoverTableExists,
  decodeCutoverRow,
  queryCutoverRow,
} from './session-host-cutover-database'
import { populateSessionReportReferenceCatalog } from './session-host-report-reference-catalog'
import { populateSessionSearchCatalog } from './session-host-search-cutover'
import { populateSessionTranscriptTermCatalog } from './session-transcript-term-cutover'

const RESOURCE_ID_DIGEST_CHARACTERS = 32

const legacySessionRowSchema = Schema.Struct({
  id: Schema.String,
  project_path: Schema.NullOr(Schema.String),
  environment_mode: Schema.String,
  worktree_path: Schema.NullOr(Schema.String),
  worktree_base_ref: Schema.NullOr(Schema.String),
  worktree_start_from_origin: Schema.Number,
  authorization_mode_override: Schema.NullOr(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  created_at: Schema.Number,
  updated_at: Schema.Number,
})

type LegacySessionRow = SchemaType<typeof legacySessionRowSchema>

const legacyActiveRunRowSchema = Schema.Struct({
  run_id: Schema.String,
  session_id: Schema.String,
  runtime_json: Schema.String,
  updated_at: Schema.Number,
})

const legacySettingRowSchema = Schema.Struct({ value_json: Schema.String })
const tableColumnRowSchema = Schema.Struct({ name: Schema.String })

function stableResourceId(kind: string, identity: string) {
  const digest = createHash('sha256')
    .update(`${kind}\0${identity}`)
    .digest('hex')
    .slice(0, RESOURCE_ID_DIGEST_CHARACTERS)
  return `workspace-${digest}`
}

function legacySetting(database: HostSqliteDatabase, key: string): unknown {
  if (!cutoverTableExists(database, 'settings_store')) return undefined
  const valueJson = queryCutoverRow(
    database,
    legacySettingRowSchema,
    'SELECT value_json FROM settings_store WHERE key = ?',
    key,
  )?.value_json
  if (valueJson === undefined) return undefined
  try {
    const value: unknown = JSON.parse(valueJson)
    return value
  } catch {
    return undefined
  }
}

function legacyExecutionDefaults(database: HostSqliteDatabase) {
  const selectedModel = legacySetting(database, 'selectedModel')
  const thinkingLevel = legacySetting(database, 'thinkingLevel')
  const resolvedThinkingLevel = THINKING_LEVELS.find((candidate) => candidate === thinkingLevel)
  return {
    modelId:
      typeof selectedModel === 'string' && selectedModel.trim()
        ? selectedModel
        : String(DEFAULT_SETTINGS.selectedModel),
    thinkingLevel: resolvedThinkingLevel ?? DEFAULT_THINKING_LEVEL,
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
export function normalizeLegacySessionColumns(database: HostSqliteDatabase) {
  if (!cutoverTableExists(database, 'sessions')) return
  const columns = new Set(
    database
      .prepare('PRAGMA table_info(sessions)')
      .all()
      .flatMap((value) => {
        const row = decodeCutoverRow(tableColumnRowSchema, value)
        return row ? [row.name] : []
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
    const identity = session.worktree_path
      ? `${projectPath}\0${session.worktree_path}`
      : `${projectPath}\0${session.id}`
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

/** A legacy row decoded with its schema; the error names each column that did not match. */
function decodeLegacyRow<A, I>(schema: Schema.Schema<A, I>, value: unknown, what: string): A {
  const decoded = safeDecodeUnknown(schema, value)
  if (!decoded.success) throw new Error(`${what} is invalid: ${decoded.issues.join('; ')}`)
  return decoded.data
}

function decodeLegacySession(value: unknown): LegacySessionRow {
  return decodeLegacyRow(legacySessionRowSchema, value, 'Legacy Session row')
}

function decodeLegacyActiveRun(value: unknown) {
  return decodeLegacyRow(legacyActiveRunRowSchema, value, 'Legacy active Run row')
}

function readLegacyRows(database: HostSqliteDatabase) {
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

export function populateSessionHostTarget(database: HostSqliteDatabase, now: number) {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_session_active_runs_status_session
    ON session_active_runs (status, session_id)
  `)
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
  const interruptLegacyActiveRun = database.prepare(`
    UPDATE session_active_runs
    SET status = 'interrupted', updated_at = ?
    WHERE run_id = ? AND session_id = ?
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
      'yolo',
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
    interruptLegacyActiveRun.run(now, run.run_id, run.session_id)
  }
  populateSessionReportReferenceCatalog(database)
  populateSessionSearchCatalog(database)
  populateSessionTranscriptTermCatalog(database)
}
