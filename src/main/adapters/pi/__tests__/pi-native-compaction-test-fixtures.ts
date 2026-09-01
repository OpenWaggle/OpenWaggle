import type { AssistantMessage, Model } from '@earendil-works/pi-ai'
import type { compact } from '@earendil-works/pi-coding-agent'

export const COMPACTION_SETTINGS = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
  thresholdPercent: 80,
}

export function makeNativeModel(
  overrides: Partial<Model<'openai-responses'>> = {},
): Model<'openai-responses'> {
  return {
    id: 'native-model',
    name: 'Native model',
    provider: 'native-provider',
    api: 'openai-responses',
    baseUrl: 'https://example.test/v1',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 10_000,
    compat: { supportsCompaction: true },
    ...overrides,
  }
}

export function makePreparation(): Parameters<typeof compact>[0] {
  return {
    firstKeptEntryId: 'kept-entry',
    messagesToSummarize: [{ role: 'user', content: 'Old context', timestamp: 1 }],
    messagesForNativeCompaction: [{ role: 'user', content: 'All context', timestamp: 1 }],
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore: 80_000,
    fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
    settings: COMPACTION_SETTINGS,
  }
}

export function makeAssistant(text: string, timestamp: number): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-responses',
    provider: 'native-provider',
    model: 'native-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp,
  }
}

export function makeCompactResponse(output: unknown[], status = 200): Response {
  const body =
    status === 200
      ? {
          id: 'cmp_response',
          object: 'response.compaction',
          created_at: 1,
          output,
          usage: {
            input_tokens: 100,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 10,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 110,
          },
        }
      : { error: { message: 'native endpoint unavailable' } }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export const NATIVE_DETAILS = {
  schemaVersion: 1,
  mechanism: 'native',
  identity: {
    api: 'openai-responses',
    provider: 'native-provider',
    baseUrl: 'https://example.test/v1',
    compactionBaseUrl: 'https://example.test/v1',
    modelId: 'native-model',
  },
  items: [{ type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-checkpoint' }],
}
