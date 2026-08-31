import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { resolveLocalSessionHostPaths } from '../../src/main/session-host/local-session-paths'
import { buildSafeElectronEnvironment } from '../safe-electron-environment'
import { completeLiveQaCleanup } from './live-session-orchestration-lifecycle'
import { prepareLiveQaCliExecutable } from './live-session-cli-executable'
import {
  cliOutcome,
  launchGui,
  runJsonCli,
  stopChild,
  waitForHost,
} from './live-session-orchestration-support'

const ARGUMENT_SEPARATOR = '--'
const FIRST_USER_ARGUMENT_INDEX = 2
const SECOND_INSTANCE_EXIT_TIMEOUT_MS = 10_000
const LEGACY_SESSION_ID = 'packaged-cutover-session'
const LEGACY_SESSION_CREATED_AT = 10
const LEGACY_SESSION_UPDATED_AT = 20

function seedLegacyDatabase(databasePath: string) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO _migrations VALUES (25, 'session-authorization-mode-override', 'now');
      CREATE TABLE settings_store (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        pi_session_id TEXT NOT NULL UNIQUE,
        pi_session_file TEXT,
        project_path TEXT,
        title TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        waggle_config_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_active_node_id TEXT,
        last_active_branch_id TEXT,
        environment_mode TEXT NOT NULL DEFAULT 'local',
        worktree_path TEXT,
        worktree_base_ref TEXT,
        worktree_start_from_origin INTEGER NOT NULL DEFAULT 0,
        authorization_mode_override TEXT
      );
      CREATE TABLE session_nodes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        parent_id TEXT,
        pi_entry_type TEXT NOT NULL,
        kind TEXT NOT NULL,
        role TEXT,
        timestamp_ms INTEGER NOT NULL,
        content_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        branch_hint_id TEXT,
        path_depth INTEGER NOT NULL,
        created_order INTEGER NOT NULL
      );
      CREATE TABLE session_active_runs (
        run_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL,
        run_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        runtime_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    database
      .prepare(`
        INSERT INTO sessions (
          id, pi_session_id, project_path, title, created_at, updated_at,
          environment_mode, authorization_mode_override
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        LEGACY_SESSION_ID,
        'packaged-cutover-pi-session',
        process.cwd(),
        'Packaged cutover fixture',
        LEGACY_SESSION_CREATED_AT,
        LEGACY_SESSION_UPDATED_AT,
        'local',
        'ask-for-approval',
      )
  } finally {
    database.close()
  }
}

function waitForExit(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('A second packaged GUI acquired the single-instance lock.'))
    }, SECOND_INSTANCE_EXIT_TIMEOUT_MS)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function packagedGuiArguments() {
  return process.platform === 'linux' ? ['--no-sandbox'] : []
}

async function assertLegacySessionMigrated(executable: string, environment: Record<string, string>) {
  const response = await runJsonCli(executable, environment, [
    'sessions',
    'list',
    '--all',
    '--limit',
    '10',
  ])
  const sessions = cliOutcome(response).sessions
  const sessionRecords: unknown[] = Array.isArray(sessions) ? sessions : []
  if (
    !Array.isArray(sessions) ||
    !sessionRecords.some(
      (session) =>
        typeof session === 'object' &&
        session !== null &&
        'sessionId' in session &&
        session.sessionId === LEGACY_SESSION_ID,
    )
  ) {
    throw new Error('The packaged GUI did not migrate the seeded legacy Session.')
  }
}

async function runScenario(executable: string, scenario: 'fresh' | 'legacy') {
  const userDataRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), `openwaggle-packaged-${scenario}-startup-`),
  )
  const paths = resolveLocalSessionHostPaths({ userDataRoot })
  if (scenario === 'legacy') seedLegacyDatabase(paths.legacyDatabasePath)
  const environment = buildSafeElectronEnvironment({
    OPENWAGGLE_AUTOMATION: '1',
    OPENWAGGLE_USER_DATA_DIR: userDataRoot,
  })
  const cliExecutable = await prepareLiveQaCliExecutable({
    executable,
    workingDirectory: userDataRoot,
  })
  const gui = launchGui(executable, environment, packagedGuiArguments())
  const guiLogs = [gui.logs]
  let passed = false
  let primaryFailure: { readonly error: unknown } | null = null
  try {
    await waitForHost(cliExecutable, environment)
    const secondGui = launchGui(executable, environment, packagedGuiArguments())
    guiLogs.push(secondGui.logs)
    try {
      await waitForExit(secondGui.child)
    } finally {
      await stopChild(secondGui.child)
    }
    if (gui.child.exitCode !== null || gui.child.signalCode !== null) {
      throw new Error('The primary packaged GUI exited after the second-instance probe.')
    }
    await waitForHost(cliExecutable, environment)
    await fs.access(paths.databasePath)
    if (scenario === 'legacy') {
      await fs.access(paths.recoveryDatabasePath)
      await assertLegacySessionMigrated(cliExecutable, environment)
    }
    passed = true
  } catch (error) {
    primaryFailure = { error }
  }
  await completeLiveQaCleanup({ gui, guiLogs, passed, primaryFailure, userDataRoot })
}

export async function verifyPackagedSessionHostStartup(executable: string) {
  await runScenario(executable, 'fresh')
  await runScenario(executable, 'legacy')
}

async function main() {
  const executable = process.argv
    .slice(FIRST_USER_ARGUMENT_INDEX)
    .find((argument) => argument !== ARGUMENT_SEPARATOR)
  if (executable === undefined || executable.trim().length === 0) {
    throw new Error('Usage: packaged-session-host-startup-smoke.ts <packaged-executable>')
  }
  const resolvedExecutable = path.resolve(executable)
  await verifyPackagedSessionHostStartup(resolvedExecutable)
  console.log(`packaged Session Host startup smoke passed: ${resolvedExecutable}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
