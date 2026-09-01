import type { Model } from '@earendil-works/pi-ai'
import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared'
import { buildSessionContext, convertToLlm, SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import {
  makeAssistant,
  makeNativeModel,
  NATIVE_DETAILS,
} from './pi-native-compaction-test-fixtures'

function makeTargetModel(contextWindow = 100_000, maxTokens = 0): Model<'openai-responses'> {
  return makeNativeModel({
    id: 'target-model',
    name: 'Target model',
    provider: 'target-provider',
    baseUrl: 'https://target.test/v1',
    contextWindow,
    maxTokens,
    compat: undefined,
  })
}

describe('Pi native compaction replay', () => {
  it('replays an opaque checkpoint only to its compatible model identity', () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({ role: 'user', content: 'Raw user context', timestamp: 1 })
    sessionManager.appendMessage(makeAssistant('Raw assistant context', 2))
    const compactionId = sessionManager.appendCompaction(
      'Native compaction checkpoint',
      'native-replacement',
      80_000,
      NATIVE_DETAILS,
    )
    const entries = sessionManager.getBranch()
    const compatibleModel = makeNativeModel()

    const compatible = buildSessionContext(entries, compactionId, undefined, compatibleModel)
    const replay = convertToLlm(compatible.messages)
    const replayBlock = replay[0]?.role === 'assistant' ? replay[0].content[0] : undefined
    expect(replayBlock).toMatchObject({
      type: 'thinking',
      thinkingSignature: JSON.stringify({
        type: 'compaction',
        id: 'cmp_1',
        encrypted_content: 'opaque-checkpoint',
      }),
    })
    expect(
      convertResponsesMessages(
        compatibleModel,
        { systemPrompt: '', messages: replay },
        new Set(['native-provider']),
      ),
    ).toEqual([{ type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-checkpoint' }])

    const reconstructed = buildSessionContext(entries, compactionId, undefined, makeTargetModel())
    expect(reconstructed.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
  })

  it('reconstructs raw history when the effective compaction endpoint changes', () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({ role: 'user', content: 'Raw user context', timestamp: 1 })
    sessionManager.appendMessage(makeAssistant('Raw assistant context', 2))
    const compactionId = sessionManager.appendCompaction(
      'Native compaction checkpoint',
      'native-replacement',
      80_000,
      {
        ...NATIVE_DETAILS,
        identity: {
          ...NATIVE_DETAILS.identity,
          compactionBaseUrl: 'https://compact-a.example.test/v1',
        },
      },
    )
    const target = makeNativeModel({
      compat: {
        supportsCompaction: true,
        compactionBaseUrl: 'https://compact-b.example.test/v1',
      },
    })

    const reconstructed = buildSessionContext(
      sessionManager.getBranch(),
      compactionId,
      undefined,
      target,
    )

    expect(reconstructed.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
  })

  it('fits raw reconstruction by dropping complete oldest turns', () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({
      role: 'user',
      content: 'old-user-context-'.repeat(4),
      timestamp: 1,
    })
    const droppedThroughEntryId = sessionManager.appendMessage(
      makeAssistant('old-assistant-context-'.repeat(4), 2),
    )
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
      makeTargetModel(12),
    )

    expect(reconstructed.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(reconstructed.messages[0]).toMatchObject({ content: 'new-user' })
    expect(reconstructed.reconstruction).toEqual({
      schemaVersion: 1,
      sourceCompactionId: compactionId,
      firstKeptEntryId,
      droppedThroughEntryId,
      targetIdentity: {
        api: 'openai-responses',
        provider: 'target-provider',
        baseUrl: 'https://target.test/v1',
        compactionBaseUrl: 'https://target.test/v1',
        modelId: 'target-model',
      },
    })
  })

  it('reserves target context for system, tools, framing, and model output', () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({ role: 'user', content: 'old-user-'.repeat(6), timestamp: 1 })
    sessionManager.appendMessage(makeAssistant('old-assistant-'.repeat(4), 2))
    const firstKeptEntryId = sessionManager.appendMessage({
      role: 'user',
      content: 'new-user-'.repeat(6),
      timestamp: 3,
    })
    sessionManager.appendMessage(makeAssistant('new-assistant-'.repeat(4), 4))
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
      makeTargetModel(100, 40),
    )

    expect(reconstructed.messages[0]).toMatchObject({ content: 'new-user-'.repeat(6) })
    expect(reconstructed.reconstruction?.firstKeptEntryId).toBe(firstKeptEntryId)
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
      makeTargetModel(100, 40),
    )

    expect(reconstructed.messages[0]).toMatchObject({ content: 'new-user' })
    expect(reconstructed.reconstruction?.firstKeptEntryId).toBe(firstKeptEntryId)
  })

  it.each([
    {
      name: 'bash execution',
      appendRecent: (sessionManager: SessionManager) =>
        sessionManager.appendMessage({
          role: 'bashExecution',
          command: 'pwd',
          output: '/repo',
          exitCode: 0,
          cancelled: false,
          truncated: false,
          timestamp: 2,
        }),
      expectedRole: 'bashExecution',
    },
    {
      name: 'branch summary',
      appendRecent: (sessionManager: SessionManager) =>
        sessionManager.branchWithSummary(
          sessionManager.getLeafId(),
          'recent branch summary',
          undefined,
          false,
        ),
      expectedRole: 'branchSummary',
    },
  ])('keeps a recent $name as a complete reconstruction unit', ({ appendRecent, expectedRole }) => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({ role: 'user', content: 'old-context-'.repeat(50), timestamp: 1 })
    appendRecent(sessionManager)
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
      makeTargetModel(100),
    )

    expect(reconstructed.messages.map((message) => message.role)).toEqual([expectedRole])
  })

  it('records a deduplicated append-only reconstruction boundary', () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({ role: 'user', content: 'old-context-'.repeat(20), timestamp: 1 })
    sessionManager.appendMessage(makeAssistant('old-response-'.repeat(20), 2))
    const firstKeptEntryId = sessionManager.appendMessage({
      role: 'user',
      content: 'latest',
      timestamp: 3,
    })
    sessionManager.appendMessage(makeAssistant('answer', 4))
    const compactionId = sessionManager.appendCompaction(
      'Native compaction checkpoint',
      'native-replacement',
      80_000,
      NATIVE_DETAILS,
    )
    const targetModel = makeTargetModel(8)

    sessionManager.buildSessionContext(targetModel)
    sessionManager.buildSessionContext(targetModel)

    const boundaries = sessionManager
      .getEntries()
      .filter(
        (entry) => entry.type === 'custom' && entry.customType === 'pi.compaction_reconstruction',
      )
    expect(boundaries).toHaveLength(1)
    expect(boundaries[0]).toMatchObject({
      data: {
        schemaVersion: 1,
        sourceCompactionId: compactionId,
        firstKeptEntryId,
        targetIdentity: { modelId: 'target-model' },
      },
    })
  })
})
