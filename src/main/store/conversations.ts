import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import type { MessagePart } from '@shared/types/agent'
import { ConversationId, MessageId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from '@shared/types/settings'
import { chooseBy } from '@shared/utils/decision'
import { isEnoent } from '@shared/utils/node-error'
import { app } from 'electron'
import { z } from 'zod'
import { createLogger } from '../logger'
import { providerRegistry } from '../providers'
import { atomicWriteJSON } from '../utils/atomic-write'

const logger = createLogger('conversations')

// ── Zod schemas for validating persisted conversations ──────────────────────

const toolCallRequestSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
})

const toolCallResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.string(),
  isError: z.boolean(),
  duration: z.number(),
})

const messagePartSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('reasoning'), text: z.string() }),
  // Backward compatibility: legacy persisted conversations stored reasoning as `thinking`.
  z.object({ type: z.literal('thinking'), text: z.string() }),
  z.object({
    type: z.literal('attachment'),
    attachment: z.object({
      id: z.string(),
      kind: z.enum(['text', 'image', 'pdf']),
      name: z.string(),
      path: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
      extractedText: z.string(),
    }),
  }),
  z.object({ type: z.literal('tool-call'), toolCall: toolCallRequestSchema }),
  z.object({ type: z.literal('tool-result'), toolResult: toolCallResultSchema }),
])

import { waggleConfigSchema, waggleMetadataSchema } from '@shared/schemas/waggle'

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  parts: z.array(messagePartSchema),
  model: z.string().optional(),
  metadata: z
    .object({
      orchestrationRunId: z.string().optional(),
      usedFallback: z.boolean().optional(),
      waggle: waggleMetadataSchema.optional(),
    })
    .optional(),
  createdAt: z.number(),
})

const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  model: z.string().optional(),
  projectPath: z.string().nullable(),
  messages: z.array(messageSchema),
  waggleConfig: waggleConfigSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  projectPath: z.string().nullable(),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const conversationIndexSchema = z.object({
  version: z.literal(1),
  conversations: z.array(conversationSummarySchema),
})

// ── Backward-compatible model ID migration ─────────────────────────────────

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
  // Preserve provider when falling back
  if (/^(gpt-|o1-|o3-|o4-)/.test(raw)) return DEFAULT_OPENAI_MODEL
  return DEFAULT_ANTHROPIC_MODEL
}

// ── Transform validated data into branded types ─────────────────────────────

type ParsedPart = z.infer<typeof messagePartSchema>
type ParsedMessage = z.infer<typeof messageSchema>
type ParsedConversationSummary = z.infer<typeof conversationSummarySchema>

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

/**
 * Parse raw JSON into a Conversation, validating structure at the boundary.
 * Returns null if the data is malformed.
 */
function parseConversation(raw: string): Conversation | null {
  const json: unknown = JSON.parse(raw)
  const result = conversationSchema.safeParse(json)
  if (!result.success) {
    logger.warn('Conversation validation failed', {
      issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    })
    return null
  }

  const data = result.data
  const legacyConversationModel =
    typeof data.model === 'string' ? migrateModelId(data.model) : undefined
  return {
    id: ConversationId(data.id),
    title: data.title,
    projectPath: data.projectPath,
    messages: data.messages.map((m: ParsedMessage) => ({
      id: MessageId(m.id),
      role: m.role,
      parts: m.parts.map(transformPart),
      model: m.model
        ? migrateModelId(m.model)
        : m.role === 'assistant'
          ? legacyConversationModel
          : undefined,
      metadata: m.metadata
        ? {
            ...m.metadata,
            waggle: m.metadata.waggle
              ? {
                  ...m.metadata.waggle,
                  agentModel: m.metadata.waggle.agentModel
                    ? SupportedModelId(m.metadata.waggle.agentModel)
                    : undefined,
                }
              : undefined,
          }
        : undefined,
      createdAt: m.createdAt,
    })),
    waggleConfig: data.waggleConfig
      ? {
          ...data.waggleConfig,
          agents: [
            {
              ...data.waggleConfig.agents[0],
              model: SupportedModelId(data.waggleConfig.agents[0].model),
            },
            {
              ...data.waggleConfig.agents[1],
              model: SupportedModelId(data.waggleConfig.agents[1].model),
            },
          ],
        }
      : undefined,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  }
}

// ── File system operations ──────────────────────────────────────────────────

function getConversationsDir(): string {
  const dir = path.join(app.getPath('userData'), 'conversations')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function conversationPath(id: ConversationId): string {
  return path.join(getConversationsDir(), `${id}.json`)
}

const CONVERSATIONS_INDEX_FILE = 'index.json'

function conversationsIndexPath(): string {
  return path.join(getConversationsDir(), CONVERSATIONS_INDEX_FILE)
}

function toSummary(conv: Conversation): ConversationSummary {
  return {
    id: conv.id,
    title: conv.title,
    projectPath: conv.projectPath,
    messageCount: conv.messages.length,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  }
}

function fromParsedSummary(summary: ParsedConversationSummary): ConversationSummary {
  return {
    id: ConversationId(summary.id),
    title: summary.title,
    projectPath: summary.projectPath,
    messageCount: summary.messageCount,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  }
}

function sortSummaries(summaries: readonly ConversationSummary[]): ConversationSummary[] {
  return [...summaries].sort((a, b) => b.updatedAt - a.updatedAt)
}

const CONVERSATION_LOAD_CONCURRENCY = 10

async function pMap<T, R>(
  items: readonly T[],
  mapper: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  // nextIndex is safe to share across workers because the read + increment
  // is synchronous (no await between check and ++) in Node's single-threaded model.
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++
      const item = items[idx]
      if (item !== undefined) {
        results[idx] = await mapper(item)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

async function readConversationIndex(): Promise<ConversationSummary[] | null> {
  try {
    const raw = await fsPromises.readFile(conversationsIndexPath(), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    const result = conversationIndexSchema.safeParse(parsed)
    if (!result.success) {
      logger.warn('Conversation index validation failed', {
        issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      })
      return null
    }
    return sortSummaries(result.data.conversations.map(fromParsedSummary))
  } catch (err) {
    if (!isEnoent(err)) {
      logger.warn('Failed to load conversation index', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return null
  }
}

async function writeConversationIndex(summaries: readonly ConversationSummary[]): Promise<void> {
  const sorted = sortSummaries(summaries)
  await atomicWriteJSON(conversationsIndexPath(), {
    version: 1 as const,
    conversations: sorted.map((summary) => ({
      id: String(summary.id),
      title: summary.title,
      projectPath: summary.projectPath,
      messageCount: summary.messageCount,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    })),
  })
}

async function scanConversationSummaries(): Promise<ConversationSummary[]> {
  const dir = getConversationsDir()
  const entries = await fsPromises.readdir(dir)
  const files = entries.filter((f) => f.endsWith('.json') && f !== CONVERSATIONS_INDEX_FILE)

  const results = await pMap(
    files,
    async (file): Promise<ConversationSummary | null> => {
      try {
        const raw = await fsPromises.readFile(path.join(dir, file), 'utf-8')
        const conv = parseConversation(raw)
        if (!conv) {
          logger.warn(`Skipping invalid conversation file: ${file}`)
          return null
        }
        return toSummary(conv)
      } catch (err) {
        logger.warn(`Failed to read conversation file "${file}"`, {
          error: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    },
    CONVERSATION_LOAD_CONCURRENCY,
  )

  return sortSummaries(
    results.filter((summary): summary is ConversationSummary => summary !== null),
  )
}

async function loadIndexForMutation(): Promise<ConversationSummary[]> {
  const indexed = await readConversationIndex()
  if (indexed) return indexed
  return scanConversationSummaries()
}

async function upsertConversationSummary(summary: ConversationSummary): Promise<void> {
  const summaries = await loadIndexForMutation()
  const next = summaries.filter((item) => item.id !== summary.id)
  next.push(summary)
  await writeConversationIndex(next)
}

async function removeConversationSummary(id: ConversationId): Promise<void> {
  const summaries = await readConversationIndex()
  if (!summaries) return
  const next = summaries.filter((item) => item.id !== id)
  if (next.length === summaries.length) return
  await writeConversationIndex(next)
}

export async function listConversations(limit?: number): Promise<ConversationSummary[]> {
  const indexed = await readConversationIndex()
  if (indexed) {
    return limit !== undefined ? indexed.slice(0, limit) : indexed
  }

  const scanned = await scanConversationSummaries()
  try {
    await writeConversationIndex(scanned)
  } catch (err) {
    logger.warn('Failed to write rebuilt conversation index', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return limit !== undefined ? scanned.slice(0, limit) : scanned
}

export async function getConversation(id: ConversationId): Promise<Conversation | null> {
  const filePath = conversationPath(id)
  try {
    const raw = await fsPromises.readFile(filePath, 'utf-8')
    return parseConversation(raw)
  } catch (err) {
    if (!isEnoent(err)) {
      logger.warn(`Failed to load conversation "${id}"`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return null
  }
}

export async function createConversation(projectPath: string | null): Promise<Conversation> {
  const now = Date.now()
  const conv: Conversation = {
    id: ConversationId(randomUUID()),
    title: 'New thread',
    projectPath,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  await saveConversation(conv)
  return conv
}

export async function saveConversation(conv: Conversation): Promise<void> {
  const updated = { ...conv, updatedAt: Date.now() }
  await atomicWriteJSON(conversationPath(conv.id), updated)
  try {
    await upsertConversationSummary(toSummary(updated))
  } catch (err) {
    logger.warn(`Failed to update conversation index for "${updated.id}"`, {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function deleteConversation(id: ConversationId): Promise<void> {
  const filePath = conversationPath(id)
  try {
    await fsPromises.unlink(filePath)
  } catch (err) {
    if (!isEnoent(err)) {
      logger.warn(`Failed to delete conversation "${id}"`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  try {
    await removeConversationSummary(id)
  } catch (err) {
    logger.warn(`Failed to update conversation index after delete for "${id}"`, {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function updateConversationTitle(id: ConversationId, title: string): Promise<void> {
  const conv = await getConversation(id)
  if (conv) {
    await saveConversation({ ...conv, title })
  }
}

export async function updateConversationProjectPath(
  id: ConversationId,
  projectPath: string | null,
): Promise<Conversation | null> {
  const conv = await getConversation(id)
  if (!conv) return null
  const updated = { ...conv, projectPath }
  await saveConversation(updated)
  return updated
}
