import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DATABASE_FILE_NAME = 'openwaggle.db'
const DB_WAIT_RETRY_DELAY_MS = 100
const DB_WAIT_TIMEOUT_MS = 10_000
const MAIN_BRANCH_NAME = 'main'
const MESSAGE_ENTRY_TYPE = 'message'
const USER_MESSAGE_KIND = 'user_message'
const ASSISTANT_MESSAGE_KIND = 'assistant_message'
const SYSTEM_MESSAGE_KIND = 'system_message'
const STANDARD_FUTURE_MODE = 'standard'
const WAGGLE_FUTURE_MODE = 'waggle'
const DEFAULT_BRANCH_UI_STATE_JSON = '{}'
const EXPANDED_NODE_IDS_DEFAULT_JSON = '[]'
const TREE_SIDEBAR_EXPANDED = 0
const SQLITE_TRUE = 1
const SQLITE_FALSE = 0
const EMPTY_INDEX = 0

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null
}

interface ConversationRowFixture {
  readonly id: string
  readonly branchId: string
  readonly createdAt: number
}

export interface SeedConversationInput {
  readonly title: string
  readonly updatedAt: number
  readonly messages: readonly unknown[]
  readonly projectPath?: string | null
  readonly waggleConfig?: unknown
  readonly archived?: boolean
}

function getDatabasePath(userDataDir: string): string {
  return path.join(userDataDir, DATABASE_FILE_NAME)
}

function openDatabase(userDataDir: string): DatabaseSync {
  const database = new DatabaseSync(getDatabasePath(userDataDir))
  database.exec('PRAGMA foreign_keys = ON')
  return database
}

/**
 * Wait for the database file to exist and for the Pi session projection schema to be ready.
 */
async function waitForDatabase(userDataDir: string): Promise<void> {
  const dbPath = getDatabasePath(userDataDir)
  const startedAt = Date.now()

  while (Date.now() - startedAt < DB_WAIT_TIMEOUT_MS) {
    if (fs.existsSync(dbPath)) {
      try {
        const db = new DatabaseSync(dbPath)
        try {
          db.prepare('SELECT 1 FROM sessions LIMIT 1').all()
          db.prepare('SELECT 1 FROM session_nodes LIMIT 1').all()
          return
        } finally {
          db.close()
        }
      } catch {
        // Schema not ready yet — retry.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, DB_WAIT_RETRY_DELAY_MS))
  }

  throw new Error('Database file did not become ready within timeout')
}

function mainBranchId(sessionId: string): string {
  return `${sessionId}:${MAIN_BRANCH_NAME}`
}

function insertSessionRow(database: DatabaseSync): ConversationRowFixture {
  const id = crypto.randomUUID()
  const now = Date.now()
  const branchId = mainBranchId(id)
  database
    .prepare(
      `
        INSERT INTO sessions (
          id,
          pi_session_id,
          pi_session_file,
          project_path,
          title,
          archived,
          waggle_config_json,
          created_at,
          updated_at,
          last_active_node_id,
          last_active_branch_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      crypto.randomUUID(),
      null,
      null,
      'E2E Seed',
      SQLITE_FALSE,
      null,
      now,
      now,
      null,
      branchId,
    )
  return { id, branchId, createdAt: now }
}

function readStringField(record: { readonly [key: string]: unknown }, key: string): string {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new Error(`Expected string field "${key}" in conversation fixture`)
  }
  return value
}

function readOptionalStringField(
  record: { readonly [key: string]: unknown },
  key: string,
): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function readOptionalNumberField(
  record: { readonly [key: string]: unknown },
  key: string,
): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readOptionalRecordField(
  record: { readonly [key: string]: unknown },
  key: string,
): { readonly [key: string]: unknown } | undefined {
  const value = record[key]
  return isRecord(value) ? value : undefined
}

function readParts(messageValue: { readonly [key: string]: unknown }): readonly unknown[] {
  const parts = messageValue.parts
  return Array.isArray(parts) ? parts : []
}

function messageKind(role: string): string {
  if (role === 'user') return USER_MESSAGE_KIND
  if (role === 'assistant') return ASSISTANT_MESSAGE_KIND
  if (role === 'system') return SYSTEM_MESSAGE_KIND
  throw new Error(`Unsupported conversation role in fixture: ${role}`)
}

function seedSessionRow(
  database: DatabaseSync,
  row: ConversationRowFixture,
  conversationInput: SeedConversationInput,
): void {
  database.exec('BEGIN')

  try {
    const projectPath =
      conversationInput.projectPath === undefined ? null : conversationInput.projectPath
    const waggleConfigJson =
      conversationInput.waggleConfig === undefined || conversationInput.waggleConfig === null
        ? null
        : JSON.stringify(conversationInput.waggleConfig)

    const lastMessage = conversationInput.messages[conversationInput.messages.length - 1]
    const lastMessageId = isRecord(lastMessage) ? readStringField(lastMessage, 'id') : null

    database
      .prepare(
        `
          UPDATE sessions
          SET title = ?,
              project_path = ?,
              waggle_config_json = ?,
              archived = ?,
              updated_at = ?,
              last_active_node_id = ?,
              last_active_branch_id = ?
          WHERE id = ?
        `,
      )
      .run(
        conversationInput.title,
        projectPath,
        waggleConfigJson,
        conversationInput.archived ? SQLITE_TRUE : SQLITE_FALSE,
        conversationInput.updatedAt,
        lastMessageId,
        row.branchId,
        row.id,
      )

    database.prepare('DELETE FROM session_nodes WHERE session_id = ?').run(row.id)

    let parentId: string | null = null
    for (const [messageIndex, messageValue] of conversationInput.messages.entries()) {
      if (!isRecord(messageValue)) {
        throw new Error('Conversation message fixture must be an object')
      }

      const messageId = readStringField(messageValue, 'id')
      const role = readStringField(messageValue, 'role')
      const model = readOptionalStringField(messageValue, 'model')
      const createdAt = readOptionalNumberField(messageValue, 'createdAt') ?? conversationInput.updatedAt
      const metadata = readOptionalRecordField(messageValue, 'metadata')
      const parts = readParts(messageValue)

      database
        .prepare(
          `
            INSERT INTO session_nodes (
              id,
              session_id,
              parent_id,
              pi_entry_type,
              kind,
              role,
              timestamp_ms,
              content_json,
              metadata_json,
              branch_hint_id,
              path_depth,
              created_order
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          messageId,
          row.id,
          parentId,
          MESSAGE_ENTRY_TYPE,
          messageKind(role),
          role,
          createdAt,
          JSON.stringify({ parts, model: model ?? null }),
          metadata ? JSON.stringify(metadata) : '{}',
          row.branchId,
          messageIndex,
          messageIndex,
        )

      parentId = messageId
    }

    database
      .prepare(
        `
          INSERT INTO session_branches (
            id,
            session_id,
            source_node_id,
            head_node_id,
            name,
            is_main,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            head_node_id = excluded.head_node_id,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        row.branchId,
        row.id,
        null,
        parentId,
        MAIN_BRANCH_NAME,
        SQLITE_TRUE,
        row.createdAt,
        conversationInput.updatedAt,
      )

    database
      .prepare(
        `
          INSERT INTO session_branch_state (
            branch_id,
            future_mode,
            waggle_preset_id,
            waggle_config_json,
            last_active_at,
            ui_state_json
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(branch_id) DO UPDATE SET
            future_mode = excluded.future_mode,
            waggle_config_json = excluded.waggle_config_json,
            last_active_at = excluded.last_active_at
        `,
      )
      .run(
        row.branchId,
        waggleConfigJson ? WAGGLE_FUTURE_MODE : STANDARD_FUTURE_MODE,
        null,
        waggleConfigJson,
        conversationInput.updatedAt,
        DEFAULT_BRANCH_UI_STATE_JSON,
      )

    database
      .prepare(
        `
          INSERT INTO session_tree_ui_state (
            session_id,
            expanded_node_ids_json,
            branches_sidebar_collapsed,
            updated_at
          )
          VALUES (?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            updated_at = excluded.updated_at
        `,
      )
      .run(
        row.id,
        EXPANDED_NODE_IDS_DEFAULT_JSON,
        TREE_SIDEBAR_EXPANDED,
        conversationInput.updatedAt,
      )

    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export async function seedSingleConversation(
  userDataDir: string,
  conversationInput: SeedConversationInput,
): Promise<void> {
  await waitForDatabase(userDataDir)
  const database = openDatabase(userDataDir)
  try {
    const row = insertSessionRow(database)
    seedSessionRow(database, row, conversationInput)
  } finally {
    database.close()
  }
}

export async function seedConversations(
  userDataDir: string,
  conversationInputs: readonly SeedConversationInput[],
): Promise<void> {
  await waitForDatabase(userDataDir)
  const database = openDatabase(userDataDir)

  try {
    for (const conversationInput of conversationInputs) {
      const row = insertSessionRow(database)
      seedSessionRow(database, row, conversationInput)
    }
  } finally {
    database.close()
  }
}
