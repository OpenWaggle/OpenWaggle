import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import type { MessagePart } from '@shared/types/agent'
import { ConversationId, MessageId, ToolCallId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from '@shared/types/settings'
import { app } from 'electron'
import { z } from 'zod'
import { providerRegistry } from '../providers'

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
  z.object({ type: z.literal('tool-call'), toolCall: toolCallRequestSchema }),
  z.object({ type: z.literal('tool-result'), toolResult: toolCallResultSchema }),
])

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  parts: z.array(messagePartSchema),
  model: z.string().optional(),
  createdAt: z.number(),
})

const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  model: z.string().optional(),
  projectPath: z.string().nullable(),
  messages: z.array(messageSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
})

// ── Backward-compatible model ID migration ─────────────────────────────────

/** Maps old model IDs to their current equivalents. Only includes actual renames. */
const LEGACY_MODEL_MAP: Record<string, SupportedModelId> = {
  'claude-sonnet-4-20250514': 'claude-sonnet-4',
  'claude-haiku-3-5-20241022': 'claude-haiku-4-5',
  'claude-3-5-haiku-20241022': 'claude-haiku-4-5',
}

function migrateModelId(raw: string): SupportedModelId {
  if (providerRegistry.isKnownModel(raw)) return raw
  const mapped = LEGACY_MODEL_MAP[raw]
  if (mapped) return mapped
  // Preserve provider when falling back
  if (/^(gpt-|o1-|o3-|o4-)/.test(raw)) return DEFAULT_OPENAI_MODEL
  return DEFAULT_ANTHROPIC_MODEL
}

// ── Transform validated data into branded types ─────────────────────────────

type ParsedPart = z.infer<typeof messagePartSchema>
type ParsedMessage = z.infer<typeof messageSchema>

function transformPart(part: ParsedPart): MessagePart {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text }
    case 'tool-call':
      return {
        type: 'tool-call',
        toolCall: {
          id: ToolCallId(part.toolCall.id),
          name: part.toolCall.name,
          args: part.toolCall.args,
        },
      }
    case 'tool-result':
      return {
        type: 'tool-result',
        toolResult: {
          id: ToolCallId(part.toolResult.id),
          name: part.toolResult.name,
          args: part.toolResult.args,
          result: part.toolResult.result,
          isError: part.toolResult.isError,
          duration: part.toolResult.duration,
        },
      }
    default: {
      const _exhaustive: never = part
      throw new Error(`Unknown part type: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/**
 * Parse raw JSON into a Conversation, validating structure at the boundary.
 * Returns null if the data is malformed.
 */
function parseConversation(raw: string): Conversation | null {
  const json: unknown = JSON.parse(raw)
  const result = conversationSchema.safeParse(json)
  if (!result.success) return null

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
      createdAt: m.createdAt,
    })),
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

export async function listConversations(): Promise<ConversationSummary[]> {
  const dir = getConversationsDir()
  const entries = await fsPromises.readdir(dir)
  const files = entries.filter((f) => f.endsWith('.json'))

  const summaries: ConversationSummary[] = []
  for (const file of files) {
    try {
      const raw = await fsPromises.readFile(path.join(dir, file), 'utf-8')
      const conv = parseConversation(raw)
      if (!conv) continue

      summaries.push({
        id: conv.id,
        title: conv.title,
        projectPath: conv.projectPath,
        messageCount: conv.messages.length,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      })
    } catch {
      // skip corrupt files
    }
  }

  return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getConversation(id: ConversationId): Promise<Conversation | null> {
  const filePath = conversationPath(id)
  try {
    const raw = await fsPromises.readFile(filePath, 'utf-8')
    return parseConversation(raw)
  } catch {
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
  const filePath = conversationPath(conv.id)
  const tmpPath = `${filePath}.tmp`

  // Atomic write: write to temp file then rename
  await fsPromises.writeFile(tmpPath, JSON.stringify(updated, null, 2), 'utf-8')
  await fsPromises.rename(tmpPath, filePath)
}

export async function deleteConversation(id: ConversationId): Promise<void> {
  const filePath = conversationPath(id)
  try {
    await fsPromises.unlink(filePath)
  } catch {
    // File may not exist
  }
}

export async function updateConversationTitle(id: ConversationId, title: string): Promise<void> {
  const conv = await getConversation(id)
  if (conv) {
    await saveConversation({ ...conv, title })
  }
}
