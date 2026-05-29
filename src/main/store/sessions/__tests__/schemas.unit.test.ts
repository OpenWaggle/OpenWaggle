import { safeDecodeUnknown } from '@shared/schema'
import { describe, expect, it } from 'vitest'
import { waggleConfigSchema } from '../schemas'

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

describe('session-store waggleConfigSchema', () => {
  it('accepts persisted inherited model bindings', () => {
    const result = safeDecodeUnknown(waggleConfigSchema, {
      ...config,
      agents: [
        { ...config.agents[0], model: '$inherit' },
        { ...config.agents[1], model: '$inherit' },
      ],
    })

    expect(result.success).toBe(true)
  })

  it('rejects persisted configs with invalid model bindings', () => {
    const result = safeDecodeUnknown(waggleConfigSchema, {
      ...config,
      agents: [{ ...config.agents[0], model: 'not-a-provider-model' }, config.agents[1]],
    })

    expect(result.success).toBe(false)
  })

  it('rejects persisted branch configs with more than two agents', () => {
    const result = safeDecodeUnknown(waggleConfigSchema, {
      ...config,
      agents: [...config.agents, { ...config.agents[0], label: 'Mediator' }],
    })

    expect(result.success).toBe(false)
  })
})
