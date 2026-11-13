import { describe, expect, it } from 'vitest'
import { safeDecodeUnknown } from '@shared/schema'
import {
  waggleConfigSchema,
  waggleInvocationMetadataSchema,
  waggleMetadataSchema,
} from '@shared/schemas/waggle'
import {
  MARKETING_WAGGLE_CONFIG,
  marketingPrompt,
  marketingReplies,
} from '../website-screenshot-fixture'

// The landing page's Waggle view and the Session tree guide show this seeded Session. A config
// the app rejects still loads, but as a plain conversation with no turns or agent models.
describe('website marketing Waggle fixture', () => {
  it('seeds a Waggle config the app accepts', () => {
    expect(safeDecodeUnknown(waggleConfigSchema, MARKETING_WAGGLE_CONFIG)).toMatchObject({
      success: true,
    })
  })

  it('attributes every reply to a Waggle turn of an agent with its own model', () => {
    expect(
      safeDecodeUnknown(
        waggleInvocationMetadataSchema,
        marketingPrompt(0).metadata.waggleInvocation,
      ),
    ).toMatchObject({ success: true })

    const turns = marketingReplies(0).map((reply) => {
      const decoded = safeDecodeUnknown(waggleMetadataSchema, reply.metadata.waggle)
      if (!decoded.success) throw new Error(decoded.issues.join('; '))
      expect(reply.model).toBe(decoded.data.agentModel)
      return decoded.data
    })

    expect(turns.map((turn) => turn.turnNumber)).toEqual(turns.map((_, index) => index))
    expect(new Set(turns.map((turn) => turn.agentModel)).size).toBe(
      MARKETING_WAGGLE_CONFIG.agents.length,
    )
    for (const turn of turns) {
      expect(turn.agentModel).toBe(MARKETING_WAGGLE_CONFIG.agents[turn.agentIndex]?.model)
    }
  })
})
