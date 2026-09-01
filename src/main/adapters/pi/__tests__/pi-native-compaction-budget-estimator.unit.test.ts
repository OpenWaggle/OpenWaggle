import type { Model } from '@earendil-works/pi-ai'
import {
  buildSessionContext,
  estimateReconstructionMessageTokens,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import {
  makeAssistant,
  makeNativeModel,
  NATIVE_DETAILS,
} from './pi-native-compaction-test-fixtures'

function makeSmallTargetModel(): Model<'openai-responses'> {
  return makeNativeModel({
    id: 'target-model',
    provider: 'target-provider',
    baseUrl: 'https://target.test/v1',
    contextWindow: 100,
    maxTokens: 40,
    compat: undefined,
  })
}

describe('Pi native compaction budget estimator', () => {
  it('conservatively budgets opaque reasoning and compaction summaries', () => {
    expect(
      estimateReconstructionMessageTokens({
        ...makeAssistant('', 1),
        content: [
          {
            type: 'thinking',
            thinking: '',
            thinkingSignature: 'opaque-signature'.repeat(30),
          },
        ],
      }),
    ).toBeGreaterThan(100)
    expect(
      estimateReconstructionMessageTokens({
        role: 'compactionSummary',
        summary: 'large portable checkpoint '.repeat(30),
        tokensBefore: 80_000,
        timestamp: 2,
      }),
    ).toBeGreaterThan(100)
  })

  it('counts replayed reasoning signatures in the target reconstruction budget', () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({ role: 'user', content: 'old reasoning turn', timestamp: 1 })
    sessionManager.appendMessage({
      ...makeAssistant('', 2),
      content: [
        {
          type: 'thinking',
          thinking: '',
          thinkingSignature: JSON.stringify({
            type: 'reasoning',
            encrypted_content: 'opaque-reasoning-'.repeat(30),
          }),
        },
      ],
    })
    const firstKeptEntryId = sessionManager.appendMessage({
      role: 'user',
      content: 'new-user',
      timestamp: 3,
    })
    sessionManager.appendMessage(makeAssistant('new-assistant', 4))
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
      makeSmallTargetModel(),
    )

    expect(reconstructed.messages[0]).toMatchObject({ content: 'new-user' })
    expect(reconstructed.reconstruction?.firstKeptEntryId).toBe(firstKeptEntryId)
  })
})
