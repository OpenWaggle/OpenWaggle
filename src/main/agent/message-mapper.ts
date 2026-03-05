import type { Message, MessagePart } from '@shared/types/agent'
import { z } from 'zod'

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
        .map((p) => ({
          id: String(p.toolCall.id),
          type: 'function' as const,
          function: {
            name: p.toolCall.name,
            arguments: JSON.stringify(p.toolCall.args),
          },
        }))

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

const screenshotDataSchema = z.object({
  base64Image: z.string(),
  mimeType: z.string(),
  pageTitle: z.string(),
  url: z.string(),
})

type ScreenshotData = z.infer<typeof screenshotDataSchema>

const normalizedJsonWrapperSchema = z.object({
  kind: z.literal('json'),
  data: z.unknown(),
})

function tryParseScreenshotData(result: string): ScreenshotData | null {
  try {
    const outer: unknown = JSON.parse(result)
    // Handle NormalizedToolResult wrapper: { kind: 'json', data: { ... } }
    const wrapper = normalizedJsonWrapperSchema.safeParse(outer)
    const payload = wrapper.success ? wrapper.data.data : outer
    const parsed = screenshotDataSchema.safeParse(payload)
    return parsed.success ? parsed.data : null
  } catch {
    // Not JSON — fall through
  }
  return null
}
