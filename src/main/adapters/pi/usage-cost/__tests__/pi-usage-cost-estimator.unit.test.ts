import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { describe, expect, it } from 'vitest'
import { createPiCatalogCostEstimator } from '../pi-usage-cost-scanner'

const TOKENS = { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 }

describe('createPiCatalogCostEstimator', () => {
  it("prices a record from Pi's built-in catalog when the record has no cost", () => {
    const model = getBuiltinModels('anthropic').find((entry) => entry.cost.input > 0)
    if (!model) throw new Error('Pi ships no priced Anthropic model')
    const estimate = createPiCatalogCostEstimator()('anthropic', model.id, TOKENS)
    expect(estimate).toBeCloseTo(model.cost.input + model.cost.output / 10, 6)
  })

  it('returns null for a model the catalog does not know', () => {
    expect(createPiCatalogCostEstimator()('anthropic', 'not-a-real-model', TOKENS)).toBeNull()
  })
})
