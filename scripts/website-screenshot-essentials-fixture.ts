import Database from 'better-sqlite3'
import { getDatabasePath, seedHive, seedSingleSession } from './support/session-fixtures'
import type { EssentialsProject } from './website-screenshot-essentials-project'
import {
  MINUTE_MS,
  TOOL_ROWS_ALTERNATE_ID,
  TOOL_ROWS_ASSISTANT_ID,
  TOOL_ROWS_UPDATED_MS,
  TOOL_ROWS_WORKER_TITLE,
  toolRowsAssistantParts,
  toolRowsMessages,
} from './website-screenshot-essentials-tool-rows'

export const TOOL_ROWS_SESSION_TITLE = 'Stop retrying 4xx uploads'
export const INTERRUPTED_SESSION_TITLE = 'Migrate config files to schema v2'

/** How long ago each seeded event happened, so the sidebar's ages read naturally. */
const INTERRUPTED_STARTED_MS = 8 * MINUTE_MS
const INTERRUPTED_REPLIED_MS = 7 * MINUTE_MS
const INTERRUPTED_UPDATED_MS = 6 * MINUTE_MS

function updateNodeParts(database: Database.Database, nodeId: string, parts: readonly unknown[]) {
  database
    .prepare('UPDATE session_nodes SET content_json = ? WHERE id = ?')
    .run(JSON.stringify({ parts, model: 'gpt-5.4' }), nodeId)
}

/**
 * A second conversation branch: another reply to the same opening message, so the sidebar row
 * shows a branch count. The main branch stays the active one.
 */
function addAlternateBranch(database: Database.Database, sessionId: string, now: number) {
  const userNode = database
    .prepare(
      `SELECT id FROM session_nodes WHERE session_id = ? AND role = 'user' ORDER BY created_order LIMIT 1`,
    )
    .get(sessionId)
  if (
    typeof userNode !== 'object' ||
    userNode === null ||
    !('id' in userNode) ||
    typeof userNode.id !== 'string'
  ) {
    throw new Error('The tool rows Session has no opening message to branch from.')
  }
  const branchId = `${sessionId}:website-alternate`
  database
    .prepare(
      `INSERT INTO session_nodes (
         id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms, content_json,
         metadata_json, branch_hint_id, path_depth, created_order
       ) VALUES (?, ?, ?, 'message', 'assistant_message', 'assistant', ?, ?, '{}', ?, 1, 2)`,
    )
    .run(
      TOOL_ROWS_ALTERNATE_ID,
      sessionId,
      userNode.id,
      now - TOOL_ROWS_UPDATED_MS,
      JSON.stringify({
        parts: [
          {
            type: 'text',
            text: 'I could also cap retries per status code. Should 429 keep retrying?',
          },
        ],
        model: 'gpt-5.4',
      }),
      branchId,
    )
  database
    .prepare(
      `INSERT INTO session_branches (id, session_id, source_node_id, head_node_id, name, is_main, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Per-status retry caps', 0, ?, ?)`,
    )
    .run(
      branchId,
      sessionId,
      userNode.id,
      TOOL_ROWS_ALTERNATE_ID,
      now - TOOL_ROWS_UPDATED_MS,
      now - TOOL_ROWS_UPDATED_MS,
    )
  database
    .prepare(
      `INSERT INTO session_branch_state (branch_id, future_mode, waggle_preset_id, waggle_config_json, last_active_at, ui_state_json)
       VALUES (?, 'standard', NULL, NULL, ?, '{}')`,
    )
    .run(branchId, now - TOOL_ROWS_UPDATED_MS)
}

/**
 * The Sessions the essentials screenshots read from the database rather than from a live Run: a
 * finished turn full of tool rows (a Queen with one Worker, and two conversation branches), and
 * an interrupted Run in a worktree whose branch is ahead of and behind its upstream.
 */
export async function seedEssentialsSessions(userDataDir: string, project: EssentialsProject) {
  console.info('[website-shots] seeding essentials sessions')
  const now = Date.now()
  await seedSingleSession(userDataDir, {
    title: INTERRUPTED_SESSION_TITLE,
    projectPath: project.projectPath,
    updatedAt: now - INTERRUPTED_UPDATED_MS,
    environmentMode: 'worktree',
    worktreePath: project.featureWorktreePath,
    interruptedRun: true,
    messages: [
      {
        id: 'website-essentials-interrupted-user',
        role: 'user',
        createdAt: now - INTERRUPTED_STARTED_MS,
        parts: [
          { type: 'text', text: 'Migrate existing config files to the schema version 2 format.' },
        ],
      },
      {
        id: 'website-essentials-interrupted-assistant',
        role: 'assistant',
        model: 'gpt-5.4',
        createdAt: now - INTERRUPTED_REPLIED_MS,
        parts: [
          {
            type: 'text',
            text: 'I’ll add a migration that reads version 1 files and writes version 2.',
          },
        ],
      },
    ],
  })
  const hive = await seedHive(
    userDataDir,
    {
      title: TOOL_ROWS_SESSION_TITLE,
      projectPath: project.projectPath,
      updatedAt: now - TOOL_ROWS_UPDATED_MS,
      messages: toolRowsMessages(now, project.projectPath),
    },
    [
      {
        title: TOOL_ROWS_WORKER_TITLE,
        delegationState: 'working',
        projectPath: project.projectPath,
        updatedAt: now - MINUTE_MS,
        messages: [],
      },
    ],
  )
  const [workerSessionId] = hive.workerSessionIds
  if (!workerSessionId) throw new Error('The tool rows Hive has no Worker.')
  const database = new Database(getDatabasePath(userDataDir))
  try {
    database.exec('PRAGMA foreign_keys = ON')
    database.transaction(() => {
      updateNodeParts(
        database,
        TOOL_ROWS_ASSISTANT_ID,
        toolRowsAssistantParts(workerSessionId, project.projectPath),
      )
      addAlternateBranch(database, hive.queenSessionId, now)
    })()
  } finally {
    database.close()
  }
  return { toolRowsSessionId: hive.queenSessionId, workerSessionId }
}
