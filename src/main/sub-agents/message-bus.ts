import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ConversationId } from '@shared/types/brand'
import type { AgentMessage, AgentMessageType } from '@shared/types/team'
import { formatErrorMessage, isEnoent } from '@shared/utils/node-error'
import { z } from 'zod'
import { createLogger } from '../logger'
import { pushContext } from '../tools/context-injection-buffer'
import { atomicWriteJSON } from '../utils/atomic-write'

const logger = createLogger('message-bus')

type MessageHandler = (message: AgentMessage) => void

const subscriptions = new Map<string, MessageHandler>()
const pendingMessages = new Map<string, AgentMessage[]>()
const shutdownCallbacks = new Map<string, (approved: boolean, reason?: string) => void>()

export function subscribe(agentName: string, handler: MessageHandler): () => void {
  subscriptions.set(agentName, handler)
  return () => {
    subscriptions.delete(agentName)
  }
}

export interface SendMessageInput {
  readonly type: AgentMessageType
  readonly sender: string
  readonly recipient?: string
  readonly content: string
  readonly summary?: string
  readonly requestId?: string
  readonly approve?: boolean
}

export function sendAgentMessage(input: SendMessageInput): string {
  const message: AgentMessage = {
    type: input.type,
    sender: input.sender,
    recipient: input.recipient,
    content: input.content,
    summary: input.summary,
    requestId: input.requestId ?? randomUUID(),
    approve: input.approve,
    timestamp: Date.now(),
  }

  if (input.type === 'broadcast') {
    broadcastMessage(message)
    return message.requestId ?? ''
  }

  if (!input.recipient) {
    logger.warn('Message has no recipient', { type: input.type, sender: input.sender })
    return ''
  }

  deliverMessage(input.recipient, message)
  return message.requestId ?? ''
}

export function sendShutdownRequest(
  sender: string,
  recipient: string,
  content: string,
): Promise<{ approved: boolean; reason?: string }> {
  const requestId = randomUUID()

  return new Promise((resolve) => {
    shutdownCallbacks.set(requestId, (approved, reason) => {
      resolve({ approved, reason })
    })

    deliverMessage(recipient, {
      type: 'shutdown_request',
      sender,
      recipient,
      content,
      requestId,
      timestamp: Date.now(),
    })
  })
}

export function handleShutdownResponse(
  requestId: string,
  approved: boolean,
  reason?: string,
): void {
  const callback = shutdownCallbacks.get(requestId)
  if (callback) {
    shutdownCallbacks.delete(requestId)
    callback(approved, reason)
  }
}

export function deliverPendingMessages(agentName: string, conversationId: ConversationId): number {
  const pending = pendingMessages.get(agentName)
  if (!pending || pending.length === 0) return 0

  pendingMessages.delete(agentName)
  for (const msg of pending) {
    const formatted = formatMessageForInjection(msg)
    pushContext(conversationId, formatted)
  }

  logger.info('Delivered pending messages', {
    recipient: agentName,
    count: pending.length,
  })

  return pending.length
}

export function getPendingMessageCount(agentName: string): number {
  return pendingMessages.get(agentName)?.length ?? 0
}

export function clearAgentMessages(agentName: string): void {
  subscriptions.delete(agentName)
  pendingMessages.delete(agentName)
}

export function clearAllMessages(): void {
  subscriptions.clear()
  pendingMessages.clear()
  shutdownCallbacks.clear()
}

function deliverMessage(recipient: string, message: AgentMessage): void {
  const handler = subscriptions.get(recipient)
  if (handler) {
    try {
      handler(message)
    } catch (error) {
      logger.error('Message handler error', {
        recipient,
        error: formatErrorMessage(error),
      })
    }
    return
  }

  // Agent not actively subscribed — queue for later delivery
  const queue = pendingMessages.get(recipient) ?? []
  queue.push(message)
  pendingMessages.set(recipient, queue)

  logger.info('Message queued (agent idle)', {
    sender: message.sender,
    recipient,
    type: message.type,
  })
}

function broadcastMessage(message: AgentMessage): void {
  for (const [name, handler] of subscriptions) {
    if (name !== message.sender) {
      try {
        handler({ ...message, recipient: name })
      } catch (error) {
        logger.error('Broadcast handler error', {
          recipient: name,
          error: formatErrorMessage(error),
        })
      }
    }
  }
}

// ── Persistence ──────────────────────────────────────────────

const AGENT_MESSAGE_TYPES = [
  'message',
  'broadcast',
  'shutdown_request',
  'shutdown_response',
  'plan_approval_request',
  'plan_approval_response',
] as const

const persistedMessageSchema = z.object({
  type: z.enum(AGENT_MESSAGE_TYPES),
  sender: z.string(),
  recipient: z.string().optional(),
  content: z.string(),
  summary: z.string().optional(),
  requestId: z.string().optional(),
  approve: z.boolean().optional(),
  timestamp: z.number(),
})

const persistedPendingSchema = z.object({
  pending: z.record(z.string(), z.array(persistedMessageSchema)),
})

export async function persistPendingMessages(projectPath: string, teamName: string): Promise<void> {
  const pending: Record<string, AgentMessage[]> = {}
  for (const [name, messages] of pendingMessages) {
    if (messages.length > 0) {
      pending[name] = messages
    }
  }

  // Skip write if nothing to persist
  if (Object.keys(pending).length === 0) return

  const dir = path.join(projectPath, '.openwaggle', 'teams', teamName)
  await fs.mkdir(dir, { recursive: true })

  const filePath = path.join(dir, 'pending-messages.json')
  await atomicWriteJSON(filePath, { pending })
  logger.info('Pending messages persisted', { teamName })
}

export async function loadPendingMessages(projectPath: string, teamName: string): Promise<boolean> {
  const filePath = path.join(projectPath, '.openwaggle', 'teams', teamName, 'pending-messages.json')
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    const data = persistedPendingSchema.parse(parsed)

    for (const [name, messages] of Object.entries(data.pending)) {
      const existing = pendingMessages.get(name) ?? []
      for (const m of messages) {
        existing.push({
          type: m.type,
          sender: m.sender,
          recipient: m.recipient,
          content: m.content,
          summary: m.summary,
          requestId: m.requestId,
          approve: m.approve,
          timestamp: m.timestamp,
        })
      }
      pendingMessages.set(name, existing)
    }

    logger.info('Pending messages loaded', { teamName })
    return true
  } catch (error) {
    if (!isEnoent(error)) {
      logger.warn('Failed to load pending messages', {
        teamName,
        error: formatErrorMessage(error),
      })
    }
    return false
  }
}

function formatMessageForInjection(message: AgentMessage): string {
  const lines: string[] = [`<agent_message type="${message.type}" from="${message.sender}">`]

  if (message.requestId) {
    lines.push(`Request ID: ${message.requestId}`)
  }
  if (message.approve !== undefined) {
    lines.push(`Approved: ${String(message.approve)}`)
  }

  lines.push(message.content)
  lines.push('</agent_message>')

  return lines.join('\n')
}
