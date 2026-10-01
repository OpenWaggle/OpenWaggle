import type { Api, Model } from '@earendil-works/pi-ai'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { modelVendorLine, selectAutomaticTitleModel } from '../pi-session-title-generator'

function model(
  id: string,
  input: number,
  output: number,
  options: {
    readonly provider?: string
    readonly reasoning?: boolean
    readonly image?: boolean
  } = {},
): Model<Api> {
  return fromPartial({
    id,
    provider: options.provider ?? 'anthropic',
    reasoning: options.reasoning ?? false,
    input: options.image ? ['image'] : ['text', 'image'],
    cost: { input, output, cacheRead: 0, cacheWrite: 0 },
    maxTokens: 8_192,
  })
}

describe('selectAutomaticTitleModel', () => {
  const opus = model('claude-opus', 15, 75)

  it('picks the cheapest available model from the Session model provider', () => {
    const haiku = model('claude-haiku', 0.8, 4)
    const sonnet = model('claude-sonnet', 3, 15)

    expect(selectAutomaticTitleModel(opus, [opus, sonnet, haiku]).id).toBe('claude-haiku')
  })

  it('never leaves the Session model provider', () => {
    const nano = model('gpt-nano', 0.05, 0.4, { provider: 'openai' })

    expect(selectAutomaticTitleModel(opus, [opus, nano]).id).toBe('claude-opus')
  })

  it('prefers a non-reasoning model over a cheaper reasoning one', () => {
    const thinking = model('thinking-mini', 0.5, 2, { reasoning: true })
    const plain = model('plain-small', 1, 5)

    expect(selectAutomaticTitleModel(opus, [thinking, plain]).id).toBe('plain-small')
  })

  it('keeps a Session model priced at zero, such as a subscription or local server', () => {
    const subscription = model('codex', 0, 0, { provider: 'openai-codex' })
    const other = model('codex-mini', 0, 0, { provider: 'openai-codex' })

    expect(selectAutomaticTitleModel(subscription, [subscription, other]).id).toBe('codex')
  })

  it('ignores models without text input and unpriced ones', () => {
    const imageOnly = model('image-only', 0.1, 0.1, { image: true })
    const unpriced = model('unpriced', 0, 0)

    expect(selectAutomaticTitleModel(opus, [imageOnly, unpriced]).id).toBe('claude-opus')
  })

  it('stays on the Session model vendor line inside an aggregating provider', () => {
    const sonnet = model('eu.anthropic.claude-sonnet-4-6', 3.3, 16.5, {
      provider: 'amazon-bedrock',
    })
    const haiku = model('eu.anthropic.claude-haiku-4-5', 1.1, 5.5, {
      provider: 'amazon-bedrock',
      reasoning: true,
    })
    const otherRegion = model('us.anthropic.claude-3-haiku', 0.25, 1.25, {
      provider: 'amazon-bedrock',
    })
    const speech = model('mistral.voxtral-mini-3b', 0.04, 0.04, { provider: 'amazon-bedrock' })

    expect(selectAutomaticTitleModel(sonnet, [sonnet, haiku, otherRegion, speech]).id).toBe(
      'eu.anthropic.claude-haiku-4-5',
    )
  })

  it('skips OpenRouter routing variants', () => {
    const gpt = model('openai/gpt-5.5', 5, 20, { provider: 'openrouter' })
    const batch = model('openai/gpt-4.1-nano:batch', 0.05, 0.2, { provider: 'openrouter' })
    const nano = model('openai/gpt-4.1-nano', 0.1, 0.4, { provider: 'openrouter' })
    const nemo = model('mistralai/mistral-nemo', 0.02, 0.03, { provider: 'openrouter' })

    expect(selectAutomaticTitleModel(gpt, [gpt, batch, nano, nemo]).id).toBe('openai/gpt-4.1-nano')
  })
})

describe('modelVendorLine', () => {
  it('reads slash, Bedrock region, and bare model ids', () => {
    expect(modelVendorLine('anthropic/claude-sonnet-4.6')).toBe('anthropic/')
    expect(modelVendorLine('eu.anthropic.claude-sonnet-4-6')).toBe('eu.anthropic.')
    expect(modelVendorLine('anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('anthropic.')
    for (const region of ['global', 'us', 'eu', 'apac', 'jp', 'au']) {
      expect(modelVendorLine(`${region}.anthropic.claude-sonnet-4-6`)).toBe(`${region}.anthropic.`)
    }
    expect(modelVendorLine('~anthropic/claude-sonnet-latest')).toBe('~anthropic/')
    expect(modelVendorLine('meta-llama/llama-4-scout:free')).toBe('meta-llama/')
    expect(modelVendorLine('gpt-5.5')).toBe('')
    expect(modelVendorLine('claude-sonnet-4-6')).toBe('')
  })
})
