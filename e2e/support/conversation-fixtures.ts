import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DATABASE_FILE_NAME = 'openwaggle.db'
const FILE_WAIT_RETRY_DELAY_MS = 100
const FILE_WAIT_TIMEOUT_MS = 5_000

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

function normalizeConversationRow(value: unknown): ConversationRowFixture | null {
  if (!isRecord(value)) {
    return null
  }

  const id = typeof value.id === 'string' ? value.id : null
  const createdAt =
    typeof value.created_at === 'number' && Number.isFinite(value.created_at)
      ? value.created_at
      : null

  if (id === null || createdAt === null) {
    return null
  }

  return { id, createdAt }
}

function listConversationRows(userDataDir: string): ConversationRowFixture[] {
  const database = openDatabase(userDataDir)
  try {
    const rows: unknown = database
      .prepare(
        `
          SELECT id, created_at
          FROM conversations
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all()

    if (!Array.isArray(rows)) {
      return []
    }

    return rows
      .map(normalizeConversationRow)
      .filter((row): row is ConversationRowFixture => row !== null)
  } catch {
    return []
  } finally {
    database.close()
  }
}

async function waitForConversationRows(
  userDataDir: string,
  expectedCount: number,
): Promise<ConversationRowFixture[]> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < FILE_WAIT_TIMEOUT_MS) {
    const rows = listConversationRows(userDataDir)
    if (rows.length >= expectedCount) {
      return rows
    }

    await new Promise((resolve) => setTimeout(resolve, FILE_WAIT_RETRY_DELAY_MS))
  }

  throw new Error(`Expected at least ${String(expectedCount)} conversation row(s)`)
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

    database
      .prepare(
        `
          UPDATE conversations
          SET title = ?, project_path = ?, archived = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        conversationInput.title,
        projectPath,
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
  const rows = await waitForConversationRows(userDataDir, 1)
  const firstRow = rows[0]
  if (!firstRow) {
    throw new Error('Expected at least one conversation row')
  }

  const database = openDatabase(userDataDir)
  try {
    seedConversationRow(database, firstRow, conversationInput)
  } finally {
    database.close()
  }
}

export async function seedConversations(
  userDataDir: string,
  conversationInputs: readonly SeedConversationInput[],
): Promise<void> {
  const rows = await waitForConversationRows(userDataDir, conversationInputs.length)
  const database = openDatabase(userDataDir)

  try {
    for (const [index, conversationInput] of conversationInputs.entries()) {
      const row = rows[index]
      if (!row) {
        throw new Error(`Expected conversation row at index ${String(index)}`)
      }

      seedConversationRow(database, row, conversationInput)
    }
  } finally {
    database.close()
  }
}
