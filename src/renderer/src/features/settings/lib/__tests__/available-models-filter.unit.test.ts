import { SupportedModelId } from '@shared/types/brand'
import type { ModelDisplayInfo } from '@shared/types/llm'
import type { ThinkingLevel } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import {
  ALL_PROVIDERS,
  type AvailableModelsProvider,
  availableModelsView,
  highlightSegments,
  type ModelFilterId,
} from '../available-models-filter'

function model(
  ref: string,
  name: string,
  options: {
    readonly available?: boolean
    readonly reasoning?: boolean
    readonly contextWindow?: number
  } = {},
): ModelDisplayInfo {
  const [provider = '', ...rest] = ref.split('/')
  const levels: readonly ThinkingLevel[] = options.reasoning ? ['off', 'low', 'high'] : ['off']
  return {
    id: SupportedModelId(ref),
    modelId: rest.join('/'),
    name,
    provider,
    available: options.available ?? true,
    availableThinkingLevels: levels,
    ...(options.contextWindow === undefined ? {} : { contextWindow: options.contextWindow }),
  }
}

const GROUPS: readonly AvailableModelsProvider[] = [
  {
    provider: 'openai',
    label: 'OpenAI',
    connected: false,
    models: [
      model('openai/gpt-5', 'GPT-5', { available: false, reasoning: true }),
      model('openai/gpt-4.1', 'GPT-4.1', { available: false, contextWindow: 1_047_576 }),
    ],
  },
  {
    provider: 'openrouter',
    label: 'OpenRouter',
    connected: true,
    models: [
      model('openrouter/qwen/qwen3-coder', 'Qwen: Qwen3 Coder 480B', { contextWindow: 262_144 }),
      model('openrouter/openai/gpt-5', 'OpenAI: GPT-5', { reasoning: true }),
    ],
  },
]

function view(
  search: string,
  filters: readonly ModelFilterId[] = [],
  enabled: readonly string[] = [],
  scope: Parameters<typeof availableModelsView>[3] = ALL_PROVIDERS,
) {
  return availableModelsView(GROUPS, { search, filters: new Set(filters) }, new Set(enabled), scope)
}

const ids = (models: readonly ModelDisplayInfo[]) => models.map((entry) => String(entry.id))

describe('Available Models search and filters', () => {
  it('opens the first signed-in provider until the user picks a scope', () => {
    expect(view('', [], [], null).scope).toBe('openrouter')
    expect(view('', [], [], 'openai').scope).toBe('openai')
    // A provider that left the catalog falls back to the default.
    expect(view('', [], [], 'mistral').scope).toBe('openrouter')
  })

  it('needs every search word to appear in the name, model ID or provider', () => {
    expect(ids(view('gpt 5').visibleModels)).toEqual(['openai/gpt-5', 'openrouter/openai/gpt-5'])
    expect(ids(view('router coder').visibleModels)).toEqual(['openrouter/qwen/qwen3-coder'])
    expect(ids(view('QWEN3-CODER').visibleModels)).toEqual(['openrouter/qwen/qwen3-coder'])
    expect(view('claude').visibleModels).toEqual([])
  })

  it('combines filters and reports matches outside the provider in scope', () => {
    const ready = view('gpt', ['ready'], [], 'openai')
    expect(ready.visibleModels).toEqual([])
    expect(ready.matchesElsewhere).toBe(1)

    expect(ids(view('', ['reasoning', 'ready']).visibleModels)).toEqual(['openrouter/openai/gpt-5'])
    expect(ids(view('', ['long-context']).visibleModels)).toEqual(['openai/gpt-4.1'])
    expect(ids(view('', ['selected'], ['openai/gpt-5']).visibleModels)).toEqual(['openai/gpt-5'])
  })

  it('counts each chip as if it were on, within the search and the provider in scope', () => {
    expect(view('gpt').counts).toEqual({
      selected: 0,
      ready: 1,
      reasoning: 2,
      'long-context': 1,
    })
    expect(view('', ['ready'], ['openai/gpt-5'], 'openai').counts).toEqual({
      selected: 0,
      ready: 0,
      reasoning: 0,
      'long-context': 0,
    })
    expect(view('', [], ['openai/gpt-5'], 'openai').counts.selected).toBe(1)
  })

  it('marks every occurrence of each search word for highlighting', () => {
    expect(highlightSegments('gpt-5-codex', 'gpt 5')).toEqual([
      { start: 0, text: 'gpt', match: true },
      { start: 3, text: '-', match: false },
      { start: 4, text: '5', match: true },
      { start: 5, text: '-codex', match: false },
    ])
    expect(highlightSegments('GPT-5', '')).toEqual([{ start: 0, text: 'GPT-5', match: false }])
  })
})
