import { describe, expect, it } from 'vitest'
import { AGENT_BG, AGENT_BORDER, AGENT_BORDER_LEFT, AGENT_TEXT } from './agent-colors'

const EXPECTED_COLORS = ['blue', 'amber', 'emerald', 'violet'] as const

describe('agent-colors', () => {
  it('AGENT_BG has an entry for every agent color', () => {
    for (const color of EXPECTED_COLORS) {
      expect(AGENT_BG[color]).toBeDefined()
      expect(AGENT_BG[color]).toContain('bg-')
    }
  })

  it('AGENT_TEXT has an entry for every agent color', () => {
    for (const color of EXPECTED_COLORS) {
      expect(AGENT_TEXT[color]).toBeDefined()
      expect(AGENT_TEXT[color]).toContain('text-')
    }
  })

  it('AGENT_BORDER has an entry for every agent color', () => {
    for (const color of EXPECTED_COLORS) {
      expect(AGENT_BORDER[color]).toBeDefined()
      expect(AGENT_BORDER[color]).toContain('border-')
    }
  })

  it('AGENT_BORDER_LEFT has an entry for every agent color', () => {
    for (const color of EXPECTED_COLORS) {
      expect(AGENT_BORDER_LEFT[color]).toBeDefined()
      expect(AGENT_BORDER_LEFT[color]).toContain('border-l-')
    }
  })

  it('all maps share exactly the same set of keys', () => {
    const bgKeys = Object.keys(AGENT_BG).sort()
    const textKeys = Object.keys(AGENT_TEXT).sort()
    const borderKeys = Object.keys(AGENT_BORDER).sort()
    const borderLeftKeys = Object.keys(AGENT_BORDER_LEFT).sort()

    expect(bgKeys).toEqual(textKeys)
    expect(bgKeys).toEqual(borderKeys)
    expect(bgKeys).toEqual(borderLeftKeys)
  })

  it('color values use consistent hex codes across maps for the same key', () => {
    // Extract hex from Tailwind class for blue
    const blueHex = '#4c8cf5'
    expect(AGENT_BG.blue).toContain(blueHex)
    expect(AGENT_TEXT.blue).toContain(blueHex)
    expect(AGENT_BORDER.blue).toContain(blueHex)
    expect(AGENT_BORDER_LEFT.blue).toContain(blueHex)
  })
})
