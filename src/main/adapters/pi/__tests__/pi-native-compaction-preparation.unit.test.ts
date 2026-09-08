import type { Model } from '@earendil-works/pi-ai'
import { prepareCompaction, SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import {
  COMPACTION_SETTINGS,
  makeAssistant,
  makeNativeModel,
  NATIVE_DETAILS,
} from './pi-native-compaction-test-fixtures'

describe('Pi native compaction preparation', () => {
  it('uses mechanism-specific overhead for native and portable reconstruction', () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({ role: 'user', content: 'old-user-'.repeat(10), timestamp: 1 })
    sessionManager.appendMessage(makeAssistant('old-assistant-'.repeat(6), 2))
    sessionManager.appendCompaction(
      'Native compaction checkpoint',
      'native-replacement',
      80_000,
      NATIVE_DETAILS,
    )
    sessionManager.appendMessage({ role: 'user', content: 'new-user-'.repeat(6), timestamp: 3 })
    sessionManager.appendMessage(makeAssistant('new-assistant-'.repeat(4), 4))

    const preparation = prepareCompaction(
      sessionManager.getBranch(),
      { ...COMPACTION_SETTINGS, reserveTokens: 20, keepRecentTokens: 1 },
      makeNativeModel({
        baseUrl: 'https://target.example.test/v1',
        contextWindow: 3_000,
        maxTokens: 20,
      }),
      { nativeRequestOverheadTokens: 2_800 },
    )

    expect(JSON.stringify(preparation?.messagesForNativeCompaction)).not.toContain('old-user')
    expect(JSON.stringify(preparation?.messagesForNativeCompaction)).toContain('new-user')
    expect(JSON.stringify(preparation?.portableFallback?.messagesToSummarize)).toContain('old-user')
  })

  it('can replace an opaque checkpoint even when Portable would retain all recent raw turns', () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({ role: 'user', content: 'old context', timestamp: 1 })
    sessionManager.appendMessage(makeAssistant('old response', 2))
    sessionManager.appendCompaction(
      'Native compaction checkpoint',
      'native-replacement',
      80_000,
      NATIVE_DETAILS,
    )
    sessionManager.appendMessage({ role: 'user', content: 'small recent turn', timestamp: 3 })
    sessionManager.appendMessage({
      ...makeAssistant('small recent response', 4),
      usage: {
        input: 80_000,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 80_010,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    })

    const preparation = prepareCompaction(
      sessionManager.getBranch(),
      COMPACTION_SETTINGS,
      makeNativeModel(),
    )

    expect(preparation).toBeDefined()
    expect(preparation?.messagesForNativeCompaction).toHaveLength(3)
  })

  it('prepares a target projection from raw history instead of an incompatible checkpoint', () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendModelChange('source-provider', 'source-model')
    sessionManager.appendMessage({ role: 'user', content: 'source raw request', timestamp: 1 })
    sessionManager.appendMessage({
      ...makeAssistant('source raw response', 2),
      provider: 'source-provider',
      model: 'source-model',
    })
    sessionManager.appendCompaction('Native compaction checkpoint', 'native-replacement', 80_000, {
      ...NATIVE_DETAILS,
      identity: {
        api: 'openai-responses',
        provider: 'source-provider',
        baseUrl: 'https://source.example.test/v1',
        modelId: 'source-model',
      },
      items: [{ type: 'compaction', id: 'cmp_source', encrypted_content: 'source-opaque' }],
    })
    sessionManager.appendModelChange('target-provider', 'target-model')
    sessionManager.appendMessage({ role: 'user', content: 'target request', timestamp: 3 })
    sessionManager.appendMessage({
      ...makeAssistant('target response', 4),
      api: 'anthropic-messages',
      provider: 'target-provider',
      model: 'target-model',
    })
    const targetModel: Model<'anthropic-messages'> = {
      id: 'target-model',
      name: 'Target model',
      provider: 'target-provider',
      api: 'anthropic-messages',
      baseUrl: 'https://target.example.test',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 100_000,
      maxTokens: 10_000,
    }

    const preparation = prepareCompaction(
      sessionManager.getBranch(),
      { ...COMPACTION_SETTINGS, keepRecentTokens: 1 },
      targetModel,
    )

    expect(preparation?.previousSummary).toBeUndefined()
    expect(preparation?.messagesForNativeCompaction.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ])
    expect(JSON.stringify(preparation?.messagesForNativeCompaction)).not.toContain('source-opaque')
    expect(JSON.stringify(preparation?.messagesToSummarize)).toContain('source raw request')
  })

  it('reconstructs raw history when Native capability is removed from the same identity', () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({
      role: 'user',
      content: 'authoritative raw request',
      timestamp: 1,
    })
    sessionManager.appendMessage(makeAssistant('authoritative raw response', 2))
    sessionManager.appendCompaction(
      'Native compaction checkpoint',
      'native-replacement',
      80_000,
      NATIVE_DETAILS,
    )
    sessionManager.appendMessage({ role: 'user', content: 'recent request', timestamp: 3 })
    sessionManager.appendMessage(makeAssistant('recent response', 4))
    const downgradedModel = makeNativeModel({ compat: undefined })

    const preparation = prepareCompaction(
      sessionManager.getBranch(),
      { ...COMPACTION_SETTINGS, keepRecentTokens: 1 },
      downgradedModel,
    )

    expect(preparation?.previousSummary).toBeUndefined()
    expect(JSON.stringify(preparation?.messagesForNativeCompaction)).toContain(
      'authoritative raw request',
    )
    expect(JSON.stringify(preparation?.messagesToSummarize)).toContain('authoritative raw request')
  })

  it('prepares an authoritative raw-history projection for an unavailable Native endpoint', () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({
      role: 'user',
      content: 'authoritative context hidden behind the opaque checkpoint',
      timestamp: 1,
    })
    sessionManager.appendMessage(makeAssistant('old response', 2))
    sessionManager.appendCompaction(
      'Native compaction checkpoint',
      'native-replacement',
      80_000,
      NATIVE_DETAILS,
    )
    sessionManager.appendMessage({ role: 'user', content: 'recent request', timestamp: 3 })
    sessionManager.appendMessage(makeAssistant('recent response', 4))

    const preparation = prepareCompaction(
      sessionManager.getBranch(),
      { ...COMPACTION_SETTINGS, keepRecentTokens: 1 },
      makeNativeModel(),
    )

    expect(preparation?.previousSummary).toBe('Native compaction checkpoint')
    expect(preparation?.portableFallback?.previousSummary).toBeUndefined()
    expect(JSON.stringify(preparation?.portableFallback?.messagesToSummarize)).toContain(
      'authoritative context hidden behind the opaque checkpoint',
    )
  })
})
