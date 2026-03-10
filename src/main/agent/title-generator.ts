import type { ConversationId } from '@shared/types/brand'
import type { Settings } from '@shared/types/settings'
import { chat, type ModelMessage } from '@tanstack/ai'
import { createLogger } from '../logger'
import type { ProviderDefinition } from '../providers/provider-definition'
import { providerRegistry } from '../providers/registry'
import { updateConversationTitle } from '../store/conversations'
import { broadcastToWindows } from '../utils/broadcast'

const logger = createLogger('title-generator')

const TITLE_FALLBACK_LENGTH = 60
const TITLE_INPUT_MAX_CHARS = 500
const TITLE_MAX_TOKENS = 60

const TITLE_SYSTEM_PROMPT =
  'You are a conversation title generator. Given the first user message of a conversation, generate a short, descriptive title (max 50 characters). Reply with ONLY the title text, no quotes, no punctuation at the end, no explanation.'

/**
 * Find the first available provider with a configured API key and return
 * its test model (cheapest/fastest) along with the provider config.
 */
function findTitleProvider(settings: Settings): {
  model: string
  apiKey: string
  provider: ProviderDefinition
  baseUrl?: string
  authMethod?: 'api-key' | 'subscription'
} | null {
  for (const provider of providerRegistry.getAll()) {
    const config = settings.providers[provider.id]
    if (!config?.enabled || !config.apiKey) {
      continue
    }
    return {
      model: provider.testModel,
      apiKey: config.apiKey,
      provider,
      baseUrl: config.baseUrl,
      authMethod: config.authMethod,
    }
  }
  return null
}

function makeFallbackTitle(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) {
    return 'New thread'
  }
  return (
    trimmed.slice(0, TITLE_FALLBACK_LENGTH) + (trimmed.length > TITLE_FALLBACK_LENGTH ? '...' : '')
  )
}

/**
 * Generate a conversation title using a fast/cheap LLM model.
 * Falls back to a truncated user message if no provider is available
 * or the LLM call fails.
 *
 * This runs fire-and-forget after the first message is sent —
 * it does NOT block the agent run.
 */
export async function generateTitle(
  conversationId: ConversationId,
  userText: string,
  settings: Settings,
): Promise<void> {
  const fallback = makeFallbackTitle(userText)

  const resolved = findTitleProvider(settings)
  if (!resolved) {
    logger.info('No provider available for title generation, using fallback')
    await persistAndBroadcastTitle(conversationId, fallback)
    return
  }

  try {
    const adapter = resolved.provider.createAdapter(
      resolved.model,
      resolved.apiKey,
      resolved.baseUrl,
      resolved.authMethod,
    )

    const messages: ModelMessage[] = [
      { role: 'user', content: userText.slice(0, TITLE_INPUT_MAX_CHARS) },
    ]

    let title = ''
    const stream = chat({
      adapter,
      messages,
      systemPrompts: [TITLE_SYSTEM_PROMPT],
      maxTokens: TITLE_MAX_TOKENS,
    })

    for await (const chunk of stream) {
      if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
        title += chunk.content
      }
    }

    title = title.trim()
    if (!title) {
      title = fallback
    }

    await persistAndBroadcastTitle(conversationId, title)
  } catch (err) {
    logger.warn('LLM title generation failed, using fallback', {
      error: err instanceof Error ? err.message : String(err),
    })
    await persistAndBroadcastTitle(conversationId, fallback)
  }
}

async function persistAndBroadcastTitle(
  conversationId: ConversationId,
  title: string,
): Promise<void> {
  try {
    await updateConversationTitle(conversationId, title)
    broadcastToWindows('conversations:title-updated', { conversationId, title })
  } catch (err) {
    logger.error('Failed to persist title', {
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
