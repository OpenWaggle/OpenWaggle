import type { Model } from '@earendil-works/pi-ai'
import { buildSessionContext, SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import {
  makeAssistant,
  makeNativeModel,
  NATIVE_DETAILS,
} from './pi-native-compaction-test-fixtures'

function makeTargetModel(): Model<'openai-responses'> {
  return makeNativeModel({
    id: 'target-model',
    provider: 'target-provider',
    baseUrl: 'https://target.test/v1',
    contextWindow: 100,
    maxTokens: 0,
    compat: undefined,
  })
}

describe('Pi Native compaction reconstruction units', () => {
  it('keeps consecutive user requests as separate reconstruction boundaries', () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({
      role: 'user',
      content: 'older-unanswered-request-'.repeat(20),
      timestamp: 1,
    })
    sessionManager.appendMessage({ role: 'user', content: 'recent request', timestamp: 2 })
    sessionManager.appendMessage(makeAssistant('recent answer', 3))
    const compactionId = sessionManager.appendCompaction(
      'Native compaction checkpoint',
      'native-replacement',
      80_000,
      NATIVE_DETAILS,
    )

    const reconstructed = buildSessionContext(
      sessionManager.getBranch(),
      compactionId,
      undefined,
      makeTargetModel(),
    )

    expect(reconstructed.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(reconstructed.messages[0]).toMatchObject({ content: 'recent request' })
  })

  it('keeps context-only custom messages in their parent user turn', () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({ role: 'user', content: 'old request', timestamp: 1 })
    sessionManager.appendMessage(makeAssistant('old answer', 2))
    sessionManager.appendMessage({
      role: 'user',
      content: 'oversized-user-'.repeat(20),
      timestamp: 3,
    })
    sessionManager.appendMessage({
      role: 'custom',
      customType: 'openwaggle.inline-visualization-context',
      content: 'selection',
      display: false,
      details: { source: 'openwaggle', kind: 'inline-visualization-context' },
      timestamp: 4,
    })
    sessionManager.appendMessage(makeAssistant('orphanable answer', 5))
    const compactionId = sessionManager.appendCompaction(
      'Native compaction checkpoint',
      'native-replacement',
      80_000,
      NATIVE_DETAILS,
    )

    const reconstructed = buildSessionContext(
      sessionManager.getBranch(),
      compactionId,
      undefined,
      makeTargetModel(),
    )

    expect(reconstructed.messages).toEqual([])
  })

  it('preserves a trigger-turn custom message as its own reconstruction boundary', () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({
      role: 'user',
      content: 'old-context-'.repeat(50),
      timestamp: 1,
    })
    sessionManager.appendMessage(makeAssistant('old response', 2))
    sessionManager.appendMessage({
      role: 'custom',
      customType: 'test.trigger-turn',
      content: 'recent custom request',
      display: true,
      timestamp: 3,
    })
    sessionManager.appendMessage(makeAssistant('recent custom answer', 4))
    const compactionId = sessionManager.appendCompaction(
      'Native compaction checkpoint',
      'native-replacement',
      80_000,
      NATIVE_DETAILS,
    )

    const reconstructed = buildSessionContext(
      sessionManager.getBranch(),
      compactionId,
      undefined,
      makeTargetModel(),
    )

    expect(reconstructed.messages.map((message) => message.role)).toEqual(['custom', 'assistant'])
  })
})
