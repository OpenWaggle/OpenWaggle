import { Schema, type SchemaType, safeDecodeUnknown } from '@shared/schema'
import type { Message, MessagePart, ToolResultPart } from '@shared/types/agent'
import { MICRO_RECENT_TOOL_RESULTS } from '../domain/compaction/compaction-types'

/**
 * Simple message shape for TanStack AI — content is always string | null.
 * Using structural typing instead of importing ModelMessage avoids
 * ConstrainedModelMessage type parameter mismatches across providers.
 */
export interface SimpleChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content:
    | string
    | null
    | Array<
        | { type: 'text'; content: string }
        | { type: 'image'; source: { type: 'data'; value: string; mimeType: string } }
        | { type: 'document'; source: { type: 'data'; value: string; mimeType: string } }
      >
  toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  toolCallId?: string
}

type SimpleToolCall = NonNullable<SimpleChatMessage['toolCalls']>[number]

/**
 * Convert our Message[] to simple ChatMessage[].
 * Handles text, tool_use, and tool_result parts.
 */
export function conversationToMessages(messages: readonly Message[]): SimpleChatMessage[] {
  const result: SimpleChatMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = msg.parts
        .map((part) => {
          if (part.type === 'text') return part.text
          if (part.type === 'attachment') {
            const extracted = part.attachment.extractedText.trim()
            if (!extracted) {
              return `[Attachment: ${part.attachment.name}]`
            }
            return `[Attachment: ${part.attachment.name}]\n${extracted}`
          }
          return ''
        })
        .filter(Boolean)
        .join('\n')
      result.push({ role: 'user', content: text })
    }

    if (msg.role === 'assistant') {
      const toolResultIds = new Set(
        msg.parts
          .filter(
            (p): p is Extract<MessagePart, { type: 'tool-result' }> => p.type === 'tool-result',
          )
          .map((p) => String(p.toolResult.id)),
      )
      const toolCalls = msg.parts
        .filter((p): p is Extract<MessagePart, { type: 'tool-call' }> => p.type === 'tool-call')
        .filter((p) => toolResultIds.has(String(p.toolCall.id)))
        .map(
          (p): SimpleToolCall => ({
            id: String(p.toolCall.id),
            type: 'function',
            function: {
              name: p.toolCall.name,
              arguments: JSON.stringify(p.toolCall.args),
            },
          }),
        )

      const textParts = msg.parts.filter(
        (p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text',
      )

      const textContent = textParts.map((p) => p.text).join('\n')

      result.push({
        role: 'assistant',
        content: textContent || null,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      })

      // Tool results as separate tool messages
      const toolResults = msg.parts.filter(
        (p): p is Extract<MessagePart, { type: 'tool-result' }> => p.type === 'tool-result',
      )
      for (const tr of toolResults) {
        // Inject multimodal image for browserScreenshot results
        if (tr.toolResult.name === 'browserScreenshot') {
          const screenshotData = tryParseScreenshotData(tr.toolResult.result)
          if (screenshotData) {
            result.push({
              role: 'tool',
              content: [
                {
                  type: 'text',
                  content: `Screenshot of ${screenshotData.url} (${screenshotData.pageTitle})`,
                },
                {
                  type: 'image',
                  source: {
                    type: 'data',
                    value: screenshotData.base64Image,
                    mimeType: screenshotData.mimeType,
                  },
                },
              ],
              toolCallId: String(tr.toolResult.id),
            })
            continue
          }
        }

        result.push({
          role: 'tool',
          content: tr.toolResult.result,
          toolCallId: String(tr.toolResult.id),
        })
      }
    }
  }

  return result
}

// ─── Microcompaction ─────────────────────────────────────────
//
// Tier 1 compaction: deterministic, no LLM call.
// Strips tool result content from older messages, keeping only the N most recent.
// Tool call metadata (name, arguments) is always preserved.

export interface MicrocompactOptions {
  readonly recentToolResultCount: number
}

const DEFAULT_MICROCOMPACT_OPTIONS: MicrocompactOptions = {
  recentToolResultCount: MICRO_RECENT_TOOL_RESULTS,
}

/**
 * Build a compact placeholder for a stripped tool result.
 * Derives the tool name from the matching toolCall in the preceding assistant message.
 */
function buildToolResultPlaceholder(
  toolCallId: string,
  messages: readonly SimpleChatMessage[],
  messageIndex: number,
): string {
  // Walk backward to find the assistant message with the matching toolCall
  for (let i = messageIndex - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role === 'assistant' && msg.toolCalls) {
      const tc = msg.toolCalls.find((t) => t.id === toolCallId)
      if (tc) {
        return `[Tool result cleared — ${tc.function.name}]`
      }
    }
  }
  return '[Tool result cleared]'
}

/**
 * Microcompact a SimpleChatMessage[] array (used in the agent message builder).
 * Keeps the `recentToolResultCount` most recent tool-role messages intact.
 * Older tool messages get their content replaced with a compact placeholder.
 */
export function microcompactMessages(
  messages: readonly SimpleChatMessage[],
  options?: MicrocompactOptions,
): { messages: SimpleChatMessage[]; strippedCount: number } {
  const { recentToolResultCount } = options ?? DEFAULT_MICROCOMPACT_OPTIONS

  // Count tool messages from the end to identify which ones to keep
  const toolMessageIndices: number[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'tool') {
      toolMessageIndices.push(i)
    }
  }

  // If we have fewer tool messages than the threshold, no compaction needed
  if (toolMessageIndices.length <= recentToolResultCount) {
    return { messages: [...messages], strippedCount: 0 }
  }

  // Indices to strip are those beyond the first `recentToolResultCount` (which are the most recent)
  const indicesToStrip = new Set(toolMessageIndices.slice(recentToolResultCount))

  let strippedCount = 0
  const compacted = messages.map((msg, idx): SimpleChatMessage => {
    if (!indicesToStrip.has(idx)) return msg
    strippedCount++
    return {
      ...msg,
      content: buildToolResultPlaceholder(msg.toolCallId ?? '', messages, idx),
    }
  })

  return { messages: compacted, strippedCount }
}

/**
 * Build a compact placeholder for a stripped domain ToolResultPart.
 */
function buildDomainToolResultPlaceholder(toolResult: ToolResultPart['toolResult']): string {
  return `[Tool result cleared — ${toolResult.name}]`
}

/**
 * Microcompact domain Message[] (used by the Waggle coordinator).
 * Same logic as microcompactMessages but operates on Message/MessagePart arrays.
 */
export function microcompactConversationMessages(
  messages: readonly Message[],
  options?: MicrocompactOptions,
): { messages: Message[]; strippedCount: number } {
  const { recentToolResultCount } = options ?? DEFAULT_MICROCOMPACT_OPTIONS

  // Collect all tool-result parts with their location: [messageIndex, partIndex]
  const toolResultLocations: Array<{ msgIdx: number; partIdx: number }> = []
  for (let msgIdx = messages.length - 1; msgIdx >= 0; msgIdx--) {
    const msg = messages[msgIdx]
    if (!msg || msg.role !== 'assistant') continue
    // Scan parts in reverse within each message too
    for (let partIdx = msg.parts.length - 1; partIdx >= 0; partIdx--) {
      if (msg.parts[partIdx]?.type === 'tool-result') {
        toolResultLocations.push({ msgIdx, partIdx })
      }
    }
  }

  if (toolResultLocations.length <= recentToolResultCount) {
    return { messages: [...messages], strippedCount: 0 }
  }

  const locationsToStrip = new Set(
    toolResultLocations.slice(recentToolResultCount).map((loc) => `${loc.msgIdx}:${loc.partIdx}`),
  )

  let strippedCount = 0
  const compacted = messages.map((msg, msgIdx): Message => {
    if (msg.role !== 'assistant') return msg

    const hasPartsToStrip = msg.parts.some((_, partIdx) =>
      locationsToStrip.has(`${msgIdx}:${partIdx}`),
    )
    if (!hasPartsToStrip) return msg

    const newParts = msg.parts.map((part, partIdx): MessagePart => {
      if (!locationsToStrip.has(`${msgIdx}:${partIdx}`)) return part
      if (part.type !== 'tool-result') return part

      strippedCount++
      return {
        type: 'tool-result',
        toolResult: {
          ...part.toolResult,
          result: buildDomainToolResultPlaceholder(part.toolResult),
        },
      }
    })

    return { ...msg, parts: newParts }
  })

  return { messages: compacted, strippedCount }
}

// ─── Screenshot parsing ──────────────────────────────────────

const screenshotDataSchema = Schema.Struct({
  base64Image: Schema.String,
  mimeType: Schema.String,
  pageTitle: Schema.String,
  url: Schema.String,
})

type ScreenshotData = SchemaType<typeof screenshotDataSchema>

const normalizedJsonWrapperSchema = Schema.Struct({
  kind: Schema.Literal('json'),
  data: Schema.Unknown,
})

function tryParseScreenshotData(result: string): ScreenshotData | null {
  try {
    const outer: unknown = JSON.parse(result)
    // Handle NormalizedToolResult wrapper: { kind: 'json', data: { ... } }
    const wrapper = safeDecodeUnknown(normalizedJsonWrapperSchema, outer)
    const payload = wrapper.success ? wrapper.data.data : outer
    const parsed = safeDecodeUnknown(screenshotDataSchema, payload)
    return parsed.success ? parsed.data : null
  } catch {
    // Not JSON — fall through
  }
  return null
}
