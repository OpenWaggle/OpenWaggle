import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DATABASE_FILE_NAME = 'openwaggle.db'
const DB_WAIT_RETRY_DELAY_MS = 100
const DB_WAIT_TIMEOUT_MS = 10_000

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null
}

interface ConversationRowFixture {
  readonly id: string
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
 * Wait for the database file to exist and be writable.
 * With lazy thread creation the app no longer eagerly creates conversation rows,
 * so we wait only for the DB file itself (schema is created on first open).
 */
async function waitForDatabase(userDataDir: string): Promise<void> {
  const dbPath = getDatabasePath(userDataDir)
  const startedAt = Date.now()

  while (Date.now() - startedAt < DB_WAIT_TIMEOUT_MS) {
    if (fs.existsSync(dbPath)) {
      // Verify the conversations table exists
      try {
        const db = new DatabaseSync(dbPath)
        try {
          db.prepare('SELECT 1 FROM conversations LIMIT 1').all()
          return
        } finally {
          db.close()
        }
      } catch {
        // Table not ready yet — retry
      }
    }
    await new Promise((resolve) => setTimeout(resolve, DB_WAIT_RETRY_DELAY_MS))
  }

  throw new Error('Database file did not become ready within timeout')
}

function insertConversationRow(database: DatabaseSync): ConversationRowFixture {
  const id = crypto.randomUUID()
  const now = Date.now()
  database
    .prepare(
      `
        INSERT INTO conversations (id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `,
    )
    .run(id, 'E2E Seed', now, now)
  return { id, createdAt: now }
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

function serializePart(part: unknown): { partType: string; contentJson: string } {
  if (!isRecord(part) || typeof part.type !== 'string') {
    throw new Error('Conversation part fixture must be an object with a string "type" field')
  }

  if (part.type === 'text' || part.type === 'reasoning' || part.type === 'thinking') {
    return {
      partType: part.type,
      contentJson: JSON.stringify({ text: readStringField(part, 'text') }),
    }
  }

  if (part.type === 'attachment') {
    return {
      partType: part.type,
      contentJson: JSON.stringify({ attachment: readOptionalRecordField(part, 'attachment') }),
    }
  }

  if (part.type === 'tool-call') {
    return {
      partType: part.type,
      contentJson: JSON.stringify({ toolCall: readOptionalRecordField(part, 'toolCall') }),
    }
  }

  if (part.type === 'tool-result') {
    return {
      partType: part.type,
      contentJson: JSON.stringify({ toolResult: readOptionalRecordField(part, 'toolResult') }),
    }
  }

  throw new Error(`Unsupported conversation part fixture type: ${part.type}`)
}

function seedConversationRow(
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

    database
      .prepare(
        `
          UPDATE conversations
          SET title = ?, project_path = ?, waggle_config_json = ?, archived = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        conversationInput.title,
        projectPath,
        waggleConfigJson,
        conversationInput.archived ? 1 : 0,
        conversationInput.updatedAt,
        row.id,
      )

    database.prepare('DELETE FROM conversation_messages WHERE conversation_id = ?').run(row.id)

    for (const [messageIndex, messageValue] of conversationInput.messages.entries()) {
      if (!isRecord(messageValue)) {
        throw new Error('Conversation message fixture must be an object')
      }

      const messageId = readStringField(messageValue, 'id')
      const role = readStringField(messageValue, 'role')
      const model = readOptionalStringField(messageValue, 'model')
      const createdAt = readOptionalNumberField(messageValue, 'createdAt') ?? conversationInput.updatedAt
      const metadata = readOptionalRecordField(messageValue, 'metadata')
      const parts = Array.isArray(messageValue.parts) ? messageValue.parts : []

      database
        .prepare(
          `
            INSERT INTO conversation_messages (
              id,
              conversation_id,
              role,
              model,
              metadata_json,
              created_at,
              position
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          messageId,
          row.id,
          role,
          model ?? null,
          metadata ? JSON.stringify(metadata) : null,
          createdAt,
          messageIndex,
        )

      for (const [partIndex, part] of parts.entries()) {
        const serialized = serializePart(part)
        database
          .prepare(
            `
              INSERT INTO conversation_message_parts (
                id,
                message_id,
                part_type,
                content_json,
                position
              )
              VALUES (?, ?, ?, ?, ?)
            `,
          )
          .run(
            `${messageId}:part:${String(partIndex)}`,
            messageId,
            serialized.partType,
            serialized.contentJson,
            partIndex,
          )
      }
    }

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
    const row = insertConversationRow(database)
    seedConversationRow(database, row, conversationInput)
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
      const row = insertConversationRow(database)
      seedConversationRow(database, row, conversationInput)
    }
  } finally {
    database.close()
  }
}
