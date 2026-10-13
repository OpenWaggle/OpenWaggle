import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { describe, expect, it } from 'vitest'
import {
  buildContextMeterValue,
  buildContextUsageRequestKey,
  findContextWindow,
} from '../context-meter-view'
import { findMentionMatch } from '../mention-match'
import {
  getThinkingButtonLabel,
  getThinkingButtonTitle,
  hasOnlyOffThinkingLevel,
} from '../thinking-level-view'

const MODEL_REF = SupportedModelId('anthropic/claude-sonnet-4-5')
const PROVIDER_MODELS: ProviderInfo[] = [
  {
    provider: 'anthropic',
    displayName: 'Anthropic',
    auth: {
      configured: true,
      source: 'api-key',
      apiKeyConfigured: true,
      apiKeySource: 'api-key',
      oauthConnected: false,
      supportsApiKey: true,
      supportsOAuth: true,
    },
    models: [
      {
        id: MODEL_REF,
        modelId: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        provider: 'anthropic',
        available: true,
        availableThinkingLevels: ['off', 'low'],
        contextWindow: 200_000,
      },
    ],
  },
]

describe('composer view helpers', () => {
  it('resolves context usage request keys and model context windows', () => {
    expect(buildContextUsageRequestKey('session-1', MODEL_REF, 'v1')).toBe(
      'session-1:anthropic/claude-sonnet-4-5:v1',
    )
    expect(buildContextUsageRequestKey(null, MODEL_REF, 'v1')).toBe('')
    expect(findContextWindow(PROVIDER_MODELS, MODEL_REF)).toBe(200_000)
    expect(findContextWindow(PROVIDER_MODELS, SupportedModelId('anthropic/missing'))).toBeNull()
  })

  it('builds context meter display state for loaded, fallback, and failed usage', () => {
    expect(
      buildContextMeterValue({
        snapshot: {
          tokens: 50_000,
          contextWindow: 200_000,
          percent: 25,
          session: {
            tokens: 160_000,
            cost: 0.4321,
            models: [
              { model: 'openai/gpt-6-luna', tokens: 150_000, cost: 0.42 },
              { model: null, tokens: 10_000, cost: 0.0121 },
            ],
          },
        },
        fallbackContextWindow: null,
        hasActiveSession: true,
        failed: false,
      }).title,
    ).toBe(
      [
        'Context: 50k / 200k tokens (25.0%)',
        'Session: 160k tokens, $0.432',
        '  openai/gpt-6-luna: $0.42 (150k tokens)',
        '  Tools and summaries: $0.0121 (10k tokens)',
      ].join('\n'),
    )

    expect(
      buildContextMeterValue({
        snapshot: { tokens: 25_000, contextWindow: 100_000, percent: 25 },
        fallbackContextWindow: null,
        hasActiveSession: true,
        failed: false,
      }),
    ).toMatchObject({
      contextWindow: 100_000,
      displayValue: '25',
      strokeColor: 'var(--color-success)',
      title: 'Context: 25k / 100k tokens (25.0%)',
    })

    expect(
      buildContextMeterValue({
        snapshot: null,
        fallbackContextWindow: 200_000,
        hasActiveSession: false,
        failed: false,
      }),
    ).toMatchObject({ displayValue: '0', title: 'Context: 0 / 200k tokens (0.0%)' })

    expect(
      buildContextMeterValue({
        snapshot: null,
        fallbackContextWindow: 200_000,
        hasActiveSession: true,
        failed: true,
      }),
    ).toMatchObject({ displayValue: '?', title: 'Context usage unavailable' })
  })

  it('finds a mention query only when the at-sign starts the current token', () => {
    expect(findMentionMatch('ask @skill', 'ask @skill'.length)).toEqual({
      query: 'skill',
      startOffset: 4,
    })
    expect(findMentionMatch('email@test', 'email@test'.length)).toBeNull()
    expect(findMentionMatch('ask @two words', 'ask @two words'.length)).toBeNull()
  })

  it('builds thinking labels and titles from model capability state', () => {
    expect(hasOnlyOffThinkingLevel(['off'])).toBe(true)
    expect(hasOnlyOffThinkingLevel(['off', 'low'])).toBe(false)
    expect(getThinkingButtonLabel(true, true, 'high')).toBe('High')
    expect(getThinkingButtonLabel(true, false, 'high')).toBe('Thinking…')
    expect(
      getThinkingButtonTitle({
        hasSelectedModel: true,
        capabilitiesKnown: true,
        selectedModelOnlySupportsOff: false,
        isAdjustedForModel: true,
        requestedThinkingLevel: 'xhigh',
        effectiveThinkingLevel: 'high',
      }),
    ).toBe('Extra High is not available for this model; using High')
  })
})
