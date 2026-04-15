import { TITLE } from '@shared/constants/text-processing'
import type { ConversationId } from '@shared/types/brand'
import type { AgentStreamChunk } from '@shared/types/stream'
import { createLogger } from '../logger'
import type { ChatAdapter } from '../ports/chat-adapter-type'
import type { ChatStreamOptions } from '../ports/chat-service'

const logger = createLogger('title-generator')

const TITLE_SYSTEM_PROMPT =
  'You are a conversation title generator. Given the first user message of a conversation, generate a short, descriptive title (max 50 characters). Do NOT repeat or duplicate words in the title. Reply with ONLY the title text, no quotes, no punctuation at the end, no explanation.'

/**
 * Remove consecutive duplicate words/fragments from a title.
 */
export function deduplicateConsecutiveWords(title: string): string {
  let result = title.replace(/\b(\w+)\s+\1\b/gi, '$1')
  result = result.replace(/\b(\w{4,})\1\b/gi, '$1')
  return result
}

function makeFallbackTitle(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) {
    return 'New thread'
  }
  return (
    trimmed.slice(0, TITLE.FALLBACK_LENGTH) + (trimmed.length > TITLE.FALLBACK_LENGTH ? '...' : '')
  )
}

export interface GenerateTitleOptions {
  readonly conversationId: ConversationId
  readonly userText: string
  readonly chatStream: (options: ChatStreamOptions) => AsyncIterable<AgentStreamChunk>
  /** Pre-resolved chat adapter, or null if no provider available */
  readonly adapter: ChatAdapter | null
  /** Persist and broadcast the title — injected by the caller */
  readonly persistTitle: (conversationId: ConversationId, title: string) => Promise<void>
}

/**
 * Generate a conversation title using a fast/cheap LLM model.
 * Pure function — all dependencies injected via options.
 */
export async function generateTitle(options: GenerateTitleOptions): Promise<void> {
  const { conversationId, userText, chatStream, adapter, persistTitle } = options
  const fallback = makeFallbackTitle(userText)

  if (!adapter) {
    logger.info('No provider available for title generation, using fallback')
    await persistTitle(conversationId, fallback)
    return
  }

  try {
    const messages: ReadonlyArray<{ role: string; content: string }> = [
      { role: 'user', content: userText.slice(0, TITLE.INPUT_MAX_CHARS) },
    ]

    let title = ''
    const stream = chatStream({
      adapter,
      messages,
      systemPrompts: [TITLE_SYSTEM_PROMPT],
      samplingOptions: { maxTokens: TITLE.MAX_TOKENS },
    })

    for await (const chunk of stream) {
      if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
        title += chunk.content
      }
    }

    title = deduplicateConsecutiveWords(title.trim())
    if (!title) {
      title = fallback
    }

    await persistTitle(conversationId, title)
  } catch (err) {
    logger.warn('LLM title generation failed, using fallback', {
      error: err instanceof Error ? err.message : String(err),
    })
    await persistTitle(conversationId, fallback)
  }
}
