import type { Model } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { getPiModelAvailableThinkingLevels } from '../pi-provider-thinking'

function thinkingModel(
  overrides: Partial<Model<'openai-responses'>> = {},
): Model<'openai-responses'> {
  return {
    id: 'reasoning-model',
    name: 'Reasoning model',
    api: 'openai-responses',
    provider: 'openai',
    baseUrl: 'https://example.test/v1',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 32_000,
    ...overrides,
  }
}

describe('getPiModelAvailableThinkingLevels', () => {
  it('returns off only for non-reasoning models', () => {
    expect(getPiModelAvailableThinkingLevels(thinkingModel({ reasoning: false }))).toEqual(['off'])
  })

  it('returns standard Pi thinking levels for reasoning models without extended support', () => {
    expect(getPiModelAvailableThinkingLevels(thinkingModel())).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
    ])
  })

  it('omits off and max when Pi marks them unsupported for the model', () => {
    expect(
      getPiModelAvailableThinkingLevels(
        thinkingModel({
          thinkingLevelMap: {
            off: null,
            xhigh: 'xhigh',
            max: null,
          },
        }),
      ),
    ).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh'])
  })

  it('returns max without off when that is the exact capability Pi declares', () => {
    expect(
      getPiModelAvailableThinkingLevels(
        thinkingModel({
          thinkingLevelMap: {
            off: null,
            max: 'max',
          },
        }),
      ),
    ).toEqual(['minimal', 'low', 'medium', 'high', 'max'])
  })

  it('returns the exact extended levels declared by Pi model metadata', () => {
    expect(
      getPiModelAvailableThinkingLevels(
        thinkingModel({
          thinkingLevelMap: {
            xhigh: 'xhigh',
            max: 'max',
          },
        }),
      ),
    ).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  })
})
