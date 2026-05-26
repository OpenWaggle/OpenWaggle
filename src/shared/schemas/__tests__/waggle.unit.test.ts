import { safeDecodeUnknown } from '@shared/schema'
import { waggleConfigSchema } from '@shared/schemas/waggle'
import { describe, expect, it } from 'vitest'

const config = {
  mode: 'sequential',
  agents: [
    {
      label: 'Architect',
      model: 'openai/gpt-5.5',
      roleDescription: 'Plans the implementation.',
      color: 'blue',
    },
    {
      label: 'Reviewer',
      model: 'anthropic/claude-sonnet-4-5',
      roleDescription: 'Reviews the implementation.',
      color: 'amber',
    },
  ],
  stop: { primary: 'consensus', maxTurnsSafety: 4 },
} as const

describe('waggleConfigSchema', () => {
  it('accepts inherited model bindings at shared app boundaries', () => {
    const result = safeDecodeUnknown(waggleConfigSchema, {
      ...config,
      agents: [
        { ...config.agents[0], model: '$inherit' },
        { ...config.agents[1], model: '$inherit' },
      ],
    })

    expect(result.success).toBe(true)
  })

  it('rejects invalid model bindings at shared app boundaries', () => {
    const result = safeDecodeUnknown(waggleConfigSchema, {
      ...config,
      agents: [{ ...config.agents[0], model: 'not-a-provider-model' }, config.agents[1]],
    })

    expect(result.success).toBe(false)
  })

  it('rejects configs with more than two agents at shared app boundaries', () => {
    const result = safeDecodeUnknown(waggleConfigSchema, {
      ...config,
      agents: [...config.agents, { ...config.agents[0], label: 'Mediator' }],
    })

    expect(result.success).toBe(false)
  })
})
