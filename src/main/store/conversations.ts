import { randomUUID } from 'node:crypto'
import * as SqlClient from '@effect/sql/SqlClient'
import { Schema, type SchemaType, safeDecodeUnknown } from '@shared/schema'
import { waggleConfigSchema, waggleMetadataSchema } from '@shared/schemas/waggle'
import type { MessagePart } from '@shared/types/agent'
import { ConversationId, MessageId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import type { JsonValue } from '@shared/types/json'
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from '@shared/types/settings'
import type { WaggleConfig } from '@shared/types/waggle'
import { chooseBy } from '@shared/utils/decision'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { providerRegistry } from '../providers'
import { runAppEffect } from '../runtime'

const logger = createLogger('conversations')

const INITIAL_POSITION = 0

interface ConversationRow {
  readonly id: string
  readonly title: string
  readonly model: string | null
  readonly project_path: string | null
  readonly archived: number
  readonly plan_mode_active: number
  readonly waggle_config_json: string | null
  readonly created_at: number
  readonly updated_at: number
}

interface ConversationSummaryRow {
  readonly id: string
  readonly title: string
  readonly project_path: string | null
  readonly archived: number
  readonly plan_mode_active: number
  readonly created_at: number
  readonly updated_at: number
  readonly message_count: number
}

interface ConversationMessageRow {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly model: string | null
  readonly metadata_json: string | null
  readonly created_at: number
  readonly position: number
}

interface ConversationMessagePartRow {
  readonly message_id: string
  readonly part_type: string
  readonly content_json: string
  readonly position: number
}

// ── Validation schemas ─────────────────────────────────────────────

const conversationJsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.mutable(Schema.Array(conversationJsonValueSchema)),
    Schema.mutable(Schema.Record({ key: Schema.String, value: conversationJsonValueSchema })),
  ),
)

const conversationJsonObjectSchema = Schema.mutable(
  Schema.Record({ key: Schema.String, value: conversationJsonValueSchema }),
)

const toolCallRequestSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  args: conversationJsonObjectSchema,
  state: Schema.optional(
    Schema.Literal('input-complete', 'approval-requested', 'approval-responded'),
  ),
  approval: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      needsApproval: Schema.Boolean,
      approved: Schema.optional(Schema.Boolean),
    }),
  ),
})

const toolCallResultSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  args: conversationJsonObjectSchema,
  result: Schema.String,
  isError: Schema.Boolean,
  duration: Schema.Number,
})

const messagePartSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('reasoning'), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('thinking'), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('attachment'),
    attachment: Schema.Struct({
      id: Schema.String,
      kind: Schema.Literal('text', 'image', 'pdf'),
      origin: Schema.optional(Schema.Literal('user-file', 'auto-paste-text')),
      name: Schema.String,
      path: Schema.String,
      mimeType: Schema.String,
      sizeBytes: Schema.Number,
      extractedText: Schema.String,
    }),
  }),
  Schema.Struct({ type: Schema.Literal('tool-call'), toolCall: toolCallRequestSchema }),
  Schema.Struct({ type: Schema.Literal('tool-result'), toolResult: toolCallResultSchema }),
)

const messageMetadataSchema = Schema.Struct({
  orchestrationRunId: Schema.optional(Schema.String),
  usedFallback: Schema.optional(Schema.Boolean),
  waggle: Schema.optional(waggleMetadataSchema),
})

type ParsedPart = SchemaType<typeof messagePartSchema>

// ── Backward-compatible model ID migration ────────────────────────

/** Maps old model IDs to their current equivalents. Only includes actual renames. */
const LEGACY_MODEL_MAP: Record<string, SupportedModelId> = {
  'claude-sonnet-4-20250514': SupportedModelId('claude-sonnet-4'),
  'claude-haiku-3-5-20241022': SupportedModelId('claude-haiku-4-5'),
  'claude-3-5-haiku-20241022': SupportedModelId('claude-haiku-4-5'),
}

function migrateModelId(raw: string): SupportedModelId {
  if (providerRegistry.isKnownModel(raw)) return SupportedModelId(raw)
  const mapped = LEGACY_MODEL_MAP[raw]
  if (mapped) return mapped
  if (/^(gpt-|o1-|o3-|o4-)/.test(raw)) return DEFAULT_OPENAI_MODEL
  return DEFAULT_ANTHROPIC_MODEL
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseJsonValue(raw: string | null): unknown {
  if (raw === null) return undefined
  return JSON.parse(raw)
}

function isObjectRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hydrateWaggleConfig(raw: unknown): WaggleConfig | undefined {
  if (raw === undefined) {
    return undefined
  }

  const parsed = safeDecodeUnknown(waggleConfigSchema, raw)
  if (!parsed.success) {
    return undefined
  }

  return {
    ...parsed.data,
    agents: [
      {
        ...parsed.data.agents[0],
        model: SupportedModelId(parsed.data.agents[0].model),
      },
      {
        ...parsed.data.agents[1],
        model: SupportedModelId(parsed.data.agents[1].model),
      },
    ],
  }
}

function partRowId(messageId: string, position: number): string {
  return `${messageId}:part:${String(position)}`
}

function transformPart(part: ParsedPart): MessagePart {
  return chooseBy(part, 'type')
    .case('text', (value): MessagePart => ({ type: 'text', text: value.text }))
    .case('reasoning', (value): MessagePart => ({ type: 'reasoning', text: value.text }))
    .case('thinking', (value): MessagePart => ({ type: 'reasoning', text: value.text }))
    .case(
      'tool-call',
      (value): MessagePart => ({
        type: 'tool-call',
        toolCall: {
          id: ToolCallId(value.toolCall.id),
          name: value.toolCall.name,
          args: value.toolCall.args,
          state: value.toolCall.state,
          approval: value.toolCall.approval,
        },
      }),
    )
    .case(
      'attachment',
      (value): MessagePart => ({
        type: 'attachment',
        attachment: value.attachment,
      }),
    )
    .case(
      'tool-result',
      (value): MessagePart => ({
        type: 'tool-result',
        toolResult: {
          id: ToolCallId(value.toolResult.id),
          name: value.toolResult.name,
          args: value.toolResult.args,
          result: value.toolResult.result,
          isError: value.toolResult.isError,
          duration: value.toolResult.duration,
        },
      }),
    )
    .assertComplete()
}

function serializePart(part: MessagePart): { partType: string; contentJson: string } {
  return chooseBy(part, 'type')
    .case('text', (value) => ({
      partType: value.type,
      contentJson: JSON.stringify({ text: value.text }),
    }))
    .case('reasoning', (value) => ({
      partType: value.type,
      contentJson: JSON.stringify({ text: value.text }),
    }))
    .case('attachment', (value) => ({
      partType: value.type,
      contentJson: JSON.stringify({ attachment: value.attachment }),
    }))
    .case('tool-call', (value) => ({
      partType: value.type,
      contentJson: JSON.stringify({
        toolCall: {
          ...value.toolCall,
          id: String(value.toolCall.id),
        },
      }),
    }))
    .case('tool-result', (value) => ({
      partType: value.type,
      contentJson: JSON.stringify({
        toolResult: {
          ...value.toolResult,
          id: String(value.toolResult.id),
        },
      }),
    }))
    .assertComplete()
}

function hydrateConversationSummary(row: ConversationSummaryRow): ConversationSummary {
  return {
    id: ConversationId(row.id),
    title: row.title,
    projectPath: row.project_path,
    messageCount: row.message_count,
    archived: row.archived === 1 ? true : undefined,
    planModeActive: row.plan_mode_active === 1 ? true : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function groupPartsByMessage(
  rows: readonly ConversationMessagePartRow[],
): Map<string, ConversationMessagePartRow[]> {
  const grouped = new Map<string, ConversationMessagePartRow[]>()
  for (const row of rows) {
    const existing = grouped.get(row.message_id)
    if (existing) {
      existing.push(row)
    } else {
      grouped.set(row.message_id, [row])
    }
  }
  return grouped
}

function hydrateConversation(
  row: ConversationRow,
  messageRows: readonly ConversationMessageRow[],
  partRows: readonly ConversationMessagePartRow[],
): Conversation | null {
  try {
    const groupedParts = groupPartsByMessage(partRows)
    const legacyConversationModel = row.model ? migrateModelId(row.model) : undefined
    const waggleConfig = hydrateWaggleConfig(parseJsonValue(row.waggle_config_json))

    const messages = messageRows.map((messageRow) => {
      const parsedMetadata = safeDecodeUnknown(
        messageMetadataSchema,
        parseJsonValue(messageRow.metadata_json),
      )
      const partsForMessage = (groupedParts.get(messageRow.id) ?? [])
        .slice()
        .sort((left, right) => left.position - right.position)
        .map((partRow) => {
          const content = parseJsonValue(partRow.content_json)
          const parsed = safeDecodeUnknown(messagePartSchema, {
            type: partRow.part_type,
            ...(isObjectRecord(content) ? content : {}),
          })
          if (!parsed.success) {
            throw new Error(
              `Invalid part payload for message ${messageRow.id}: ${parsed.issues.join('; ')}`,
            )
          }
          return transformPart(parsed.data)
        })

      return {
        id: MessageId(messageRow.id),
        role: messageRow.role,
        parts: partsForMessage,
        model: messageRow.model
          ? migrateModelId(messageRow.model)
          : messageRow.role === 'assistant'
            ? legacyConversationModel
            : undefined,
        metadata: parsedMetadata.success
          ? parsedMetadata.data
            ? {
                ...parsedMetadata.data,
                waggle: parsedMetadata.data.waggle
                  ? {
                      ...parsedMetadata.data.waggle,
                      agentModel: parsedMetadata.data.waggle.agentModel
                        ? SupportedModelId(parsedMetadata.data.waggle.agentModel)
                        : undefined,
                    }
                  : undefined,
              }
            : undefined
          : undefined,
        createdAt: messageRow.created_at,
      }
    })

    return {
      id: ConversationId(row.id),
      title: row.title,
      projectPath: row.project_path,
      messages,
      waggleConfig,
      archived: row.archived === 1 ? true : undefined,
      planModeActive: row.plan_mode_active === 1 ? true : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  } catch (error) {
    logger.warn('Failed to hydrate conversation from SQLite', {
      conversationId: row.id,
      error: describeError(error),
    })
    return null
  }
}

export async function listConversations(limit?: number): Promise<ConversationSummary[]> {
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const effectiveLimit = limit ?? -1
      const rows = yield* sql<ConversationSummaryRow>`
        SELECT
          c.id,
          c.title,
          c.project_path,
          c.archived,
          c.plan_mode_active,
          c.created_at,
          c.updated_at,
          (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = c.id) AS message_count
        FROM conversations c
        WHERE c.archived = 0
        ORDER BY c.updated_at DESC
        LIMIT ${effectiveLimit}
      `

      return rows.map(hydrateConversationSummary)
    }),
  )
}

export async function listArchivedConversations(): Promise<ConversationSummary[]> {
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<ConversationSummaryRow>`
        SELECT
          c.id,
          c.title,
          c.project_path,
          c.archived,
          c.plan_mode_active,
          c.created_at,
          c.updated_at,
          (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = c.id) AS message_count
        FROM conversations c
        WHERE c.archived = 1
        ORDER BY c.updated_at DESC
      `

      return rows.map(hydrateConversationSummary)
    }),
  )
}

export async function archiveConversation(id: ConversationId): Promise<void> {
  await updateArchivedState(id, true)
}

export async function unarchiveConversation(id: ConversationId): Promise<void> {
  await updateArchivedState(id, false)
}

async function updateArchivedState(id: ConversationId, archived: boolean): Promise<void> {
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE conversations
        SET archived = ${archived ? 1 : 0},
            updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )
}

export async function getConversation(id: ConversationId): Promise<Conversation | null> {
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const conversations = yield* sql<ConversationRow>`
        SELECT
          id,
          title,
          model,
          project_path,
          archived,
          plan_mode_active,
          waggle_config_json,
          created_at,
          updated_at
        FROM conversations
        WHERE id = ${id}
        LIMIT 1
      `

      const row = conversations[INITIAL_POSITION]
      if (!row) return null

      const messageRows = yield* sql<ConversationMessageRow>`
        SELECT
          id,
          role,
          model,
          metadata_json,
          created_at,
          position
        FROM conversation_messages
        WHERE conversation_id = ${id}
        ORDER BY position ASC
      `

      const partRows = yield* sql<ConversationMessagePartRow>`
        SELECT
          cmp.message_id,
          cmp.part_type,
          cmp.content_json,
          cmp.position
        FROM conversation_message_parts cmp
        INNER JOIN conversation_messages cm ON cm.id = cmp.message_id
        WHERE cm.conversation_id = ${id}
        ORDER BY cm.position ASC, cmp.position ASC
      `

      return hydrateConversation(row, messageRows, partRows)
    }),
  )
}

export async function createConversation(projectPath: string | null): Promise<Conversation> {
  const now = Date.now()
  const conversation: Conversation = {
    id: ConversationId(randomUUID()),
    title: 'New thread',
    projectPath,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  await saveConversation(conversation)
  return conversation
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  const updatedAt = Date.now()
  const persistedConversation: Conversation = { ...conversation, updatedAt }

  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO conversations (
              id,
              title,
              model,
              project_path,
              archived,
              plan_mode_active,
              waggle_config_json,
              created_at,
              updated_at
            )
            VALUES (
              ${persistedConversation.id},
              ${persistedConversation.title},
              ${null},
              ${persistedConversation.projectPath},
              ${persistedConversation.archived ? 1 : 0},
              ${persistedConversation.planModeActive ? 1 : 0},
              ${
                persistedConversation.waggleConfig
                  ? JSON.stringify(persistedConversation.waggleConfig)
                  : null
              },
              ${persistedConversation.createdAt},
              ${persistedConversation.updatedAt}
            )
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              model = excluded.model,
              project_path = excluded.project_path,
              archived = excluded.archived,
              plan_mode_active = excluded.plan_mode_active,
              waggle_config_json = excluded.waggle_config_json,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
          `

          // Collect IDs for selective deletion instead of delete-all + re-insert.
          const messageIds = persistedConversation.messages.map((m) => String(m.id))
          const allPartIds: string[] = []

          for (const [messageIndex, message] of persistedConversation.messages.entries()) {
            for (let partIndex = 0; partIndex < message.parts.length; partIndex++) {
              allPartIds.push(partRowId(String(message.id), partIndex))
            }

            yield* sql`
              INSERT INTO conversation_messages (
                id,
                conversation_id,
                role,
                model,
                metadata_json,
                created_at,
                position
              )
              VALUES (
                ${message.id},
                ${persistedConversation.id},
                ${message.role},
                ${message.model ?? null},
                ${message.metadata ? JSON.stringify(message.metadata) : null},
                ${message.createdAt},
                ${messageIndex}
              )
              ON CONFLICT(id) DO UPDATE SET
                role = excluded.role,
                model = excluded.model,
                metadata_json = excluded.metadata_json,
                created_at = excluded.created_at,
                position = excluded.position
            `

            for (const [partIndex, part] of message.parts.entries()) {
              const serialized = serializePart(part)
              yield* sql`
                INSERT INTO conversation_message_parts (
                  id,
                  message_id,
                  part_type,
                  content_json,
                  position
                )
                VALUES (
                  ${partRowId(String(message.id), partIndex)},
                  ${message.id},
                  ${serialized.partType},
                  ${serialized.contentJson},
                  ${partIndex}
                )
                ON CONFLICT(id) DO UPDATE SET
                  part_type = excluded.part_type,
                  content_json = excluded.content_json,
                  position = excluded.position
              `
            }
          }

          // Remove messages and parts that are no longer present.
          // Parts are cascade-deleted when their parent message is deleted,
          // so we only need explicit part deletion for messages that still exist
          // but had parts removed.
          if (messageIds.length > 0) {
            const messageIdList = messageIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')
            yield* sql.unsafe(
              `DELETE FROM conversation_message_parts
               WHERE message_id IN (${messageIdList})
                 AND id NOT IN (${allPartIds.length > 0 ? allPartIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',') : "''"})`,
            )
            yield* sql.unsafe(
              `DELETE FROM conversation_messages
               WHERE conversation_id = '${String(persistedConversation.id).replace(/'/g, "''")}'
                 AND id NOT IN (${messageIdList})`,
            )
          } else {
            yield* sql`
              DELETE FROM conversation_messages
              WHERE conversation_id = ${persistedConversation.id}
            `
          }
        }),
      )
    }),
  )
}

export async function deleteConversation(id: ConversationId): Promise<void> {
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        DELETE FROM conversations
        WHERE id = ${id}
      `
    }),
  )
}

export async function updateConversationTitle(id: ConversationId, title: string): Promise<void> {
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE conversations
        SET title = ${title},
            updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )
}

export async function updateConversationProjectPath(
  id: ConversationId,
  projectPath: string | null,
): Promise<Conversation | null> {
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE conversations
        SET project_path = ${projectPath},
            updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )

  return getConversation(id)
}

export async function updateConversationPlanMode(
  id: ConversationId,
  planModeActive: boolean,
): Promise<Conversation | null> {
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE conversations
        SET plan_mode_active = ${planModeActive ? 1 : 0},
            updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )

  return getConversation(id)
}
