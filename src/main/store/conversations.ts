import fs from 'node:fs'
import path from 'node:path'
import type { MessagePart } from '@shared/types/agent'
import { ConversationId, MessageId, ToolCallId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import { SUPPORTED_MODELS } from '@shared/types/llm'
import { app } from 'electron'
import { v4 as uuid } from 'uuid'
import { z } from 'zod'

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
  model: z.string(),
  projectPath: z.string().nullable(),
  messages: z.array(messageSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
})

// ── Backward-compatible model ID migration ─────────────────────────────────

const LEGACY_MODEL_MAP: Record<string, SupportedModelId> = {
  'claude-sonnet-4-20250514': 'claude-sonnet-4',
  'claude-haiku-3-5-20241022': 'claude-haiku-4-5',
  'claude-3-5-haiku-20241022': 'claude-haiku-4-5',
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
  'o3-mini': 'o3-mini',
}

function migrateModelId(raw: string): SupportedModelId {
  if ((SUPPORTED_MODELS as readonly string[]).includes(raw)) {
    return raw as SupportedModelId
  }
  return LEGACY_MODEL_MAP[raw] ?? 'claude-sonnet-4-5'
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
  return {
    id: ConversationId(data.id),
    title: data.title,
    model: migrateModelId(data.model),
    projectPath: data.projectPath,
    messages: data.messages.map((m: ParsedMessage) => ({
      id: MessageId(m.id),
      role: m.role,
      parts: m.parts.map(transformPart),
      model: m.model ? migrateModelId(m.model) : undefined,
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

function conversationPath(id: string): string {
  return path.join(getConversationsDir(), `${id}.json`)
}

export function listConversations(): ConversationSummary[] {
  const dir = getConversationsDir()
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))

  const summaries: ConversationSummary[] = []
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8')
      const conv = parseConversation(raw)
      if (!conv) continue

      summaries.push({
        id: conv.id,
        title: conv.title,
        model: conv.model,
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

export function getConversation(id: string): Conversation | null {
  const filePath = conversationPath(id)
  if (!fs.existsSync(filePath)) return null

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return parseConversation(raw)
  } catch {
    return null
  }
}

export function createConversation(
  model: SupportedModelId,
  projectPath: string | null,
): Conversation {
  const now = Date.now()
  const conv: Conversation = {
    id: ConversationId(uuid()),
    title: 'New Conversation',
    model,
    projectPath,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  saveConversation(conv)
  return conv
}

export function saveConversation(conv: Conversation): void {
  const updated = { ...conv, updatedAt: Date.now() }
  fs.writeFileSync(conversationPath(conv.id), JSON.stringify(updated, null, 2), 'utf-8')
}

export function deleteConversation(id: string): void {
  const filePath = conversationPath(id)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

export function updateConversationTitle(id: string, title: string): void {
  const conv = getConversation(id)
  if (conv) {
    saveConversation({ ...conv, title })
  }
}
