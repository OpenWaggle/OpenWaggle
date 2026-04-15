import { randomUUID } from 'node:crypto'
import * as SqlClient from '@effect/sql/SqlClient'
import { ConversationId, MessageId } from '@shared/types/brand'
import type { PinnedItem, PinnedItemInput } from '@shared/types/context'
import * as Effect from 'effect/Effect'
import { estimateTokens } from '../domain/compaction/token-estimation'
import { runAppEffect } from '../runtime'

interface PinnedContextRow {
  readonly id: string
  readonly conversation_id: string
  readonly type: string
  readonly content: string
  readonly message_id: string | null
  readonly created_at: number
}

function hydrateRow(row: PinnedContextRow): PinnedItem {
  return {
    id: row.id,
    conversationId: ConversationId(row.conversation_id),
    type: row.type === 'instruction' ? 'instruction' : 'message',
    content: row.content,
    messageId: row.message_id ? MessageId(row.message_id) : undefined,
    createdAt: row.created_at,
  }
}

export async function listPinnedItems(conversationId: ConversationId): Promise<PinnedItem[]> {
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<PinnedContextRow>`
        SELECT id, conversation_id, type, content, message_id, created_at
        FROM pinned_context
        WHERE conversation_id = ${conversationId}
        ORDER BY created_at ASC
      `
      return rows.map(hydrateRow)
    }),
  )
}

export async function addPinnedItem(
  conversationId: ConversationId,
  item: PinnedItemInput,
): Promise<PinnedItem> {
  const id = randomUUID()
  const now = Date.now()

  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO pinned_context (id, conversation_id, type, content, message_id, created_at)
        VALUES (
          ${id},
          ${conversationId},
          ${item.type},
          ${item.content},
          ${item.messageId ? String(item.messageId) : null},
          ${now}
        )
      `
    }),
  )

  return {
    id,
    conversationId,
    type: item.type,
    content: item.content,
    messageId: item.messageId,
    createdAt: now,
  }
}

export async function removePinnedItem(conversationId: ConversationId, id: string): Promise<void> {
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`DELETE FROM pinned_context WHERE id = ${id} AND conversation_id = ${conversationId}`
    }),
  )
}

export async function removePinnedItemByMessageId(
  conversationId: ConversationId,
  messageId: MessageId | string,
): Promise<void> {
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`DELETE FROM pinned_context WHERE message_id = ${messageId} AND conversation_id = ${conversationId}`
    }),
  )
}

export async function getPinnedTokenEstimate(conversationId: ConversationId): Promise<number> {
  const items = await listPinnedItems(conversationId)
  let total = 0
  for (const item of items) {
    total += estimateTokens(item.content)
  }
  return total
}
