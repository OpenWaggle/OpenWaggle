import { SupportedModelId, WagglePresetId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import type { WagglePreset } from '@shared/types/waggle'

export const PROJECT_PATH = '/tmp/openwaggle-project'

export const PROVIDER_MODELS: ProviderInfo[] = [
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
        id: SupportedModelId('anthropic/claude-sonnet-4-5'),
        modelId: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        provider: 'anthropic',
        available: true,
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
      },
      {
        id: SupportedModelId('anthropic/claude-opus-4'),
        modelId: 'claude-opus-4',
        name: 'Claude Opus 4',
        provider: 'anthropic',
        available: true,
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
      },
    ],
  },
]

export function createPreset(overrides?: Partial<WagglePreset>) {
  return {
    id: WagglePresetId('preset-1'),
    name: 'Review Pair',
    description: 'Custom: Finds regressions before they land.',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Reviewer',
          model: SupportedModelId('anthropic/claude-sonnet-4-5'),
          roleDescription: 'Finds regressions before they land.',
          color: 'blue',
        },
        {
          label: 'Implementer',
          model: SupportedModelId('anthropic/claude-opus-4'),
          roleDescription: 'Shapes the implementation details.',
          color: 'amber',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: 8 },
    },
    isBuiltIn: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } satisfies WagglePreset
}
