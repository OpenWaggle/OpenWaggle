import type { Api, Model } from '@earendil-works/pi-ai'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { selectAutomaticTitleModel } from '../pi-session-title-generator'

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
})
