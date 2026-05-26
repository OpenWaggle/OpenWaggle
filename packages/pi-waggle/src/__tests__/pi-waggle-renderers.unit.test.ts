import type { MessageRenderer } from '@mariozechner/pi-coding-agent'
import { visibleWidth } from '@mariozechner/pi-tui'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { registerPiWaggleRenderers } from '../renderers'

function registerHarness() {
  const renderers = new Map<string, MessageRenderer<unknown>>()
  registerPiWaggleRenderers({
    registerMessageRenderer: (customType, renderer) => {
      renderers.set(customType, fromPartial<MessageRenderer<unknown>>(renderer))
    },
  })
  return renderers
}

describe('pi-waggle renderers', () => {
  it('normalizes renderer output to single terminal lines', () => {
    const renderers = registerHarness()
    const requestRenderer = renderers.get('pi-waggle.user-request')
    if (!requestRenderer) {
      throw new Error('Expected Waggle request renderer to be registered')
    }

    const requestComponent = requestRenderer(
      fromPartial({ content: 'Review\nthis\rmigration' }),
      fromPartial({}),
      fromPartial({}),
    )
    if (!requestComponent) {
      throw new Error('Expected Waggle request renderer component')
    }

    expect(requestComponent.render(120)).toEqual(['🐝 Waggle request: Review this migration'])
  })

  it('truncates renderer output by terminal-visible width', () => {
    const renderers = registerHarness()
    const turnRenderer = renderers.get('pi-waggle.turn')
    if (!turnRenderer) {
      throw new Error('Expected Waggle turn renderer to be registered')
    }

    const turnComponent = turnRenderer(
      fromPartial({
        details: {
          runId: 'waggle-1',
          turnNumber: 1,
          agentIndex: 1,
          agentLabel: 'Reviewer🐝Reviewer🐝Reviewer',
          agentModel: 'anthropic/claude-sonnet-4-🐝🐝🐝',
          agentColor: 'amber',
        },
      }),
      fromPartial({}),
      fromPartial({}),
    )
    if (!turnComponent) {
      throw new Error('Expected Waggle turn renderer component')
    }

    expect(turnComponent.render(20).every((line) => visibleWidth(line) <= 20)).toBe(true)
  })

  it('renders Waggle messages with the bee icon', () => {
    const renderers = registerHarness()
    const requestRenderer = renderers.get('pi-waggle.user-request')
    const turnRenderer = renderers.get('pi-waggle.turn')
    if (!requestRenderer || !turnRenderer) {
      throw new Error('Expected Waggle renderers to be registered')
    }

    const requestComponent = requestRenderer(
      fromPartial({ content: 'Review the current changes' }),
      fromPartial({}),
      fromPartial({}),
    )
    const turnComponent = turnRenderer(
      fromPartial({
        content: 'hidden prompt',
        details: {
          runId: 'waggle-1',
          turnNumber: 1,
          agentIndex: 1,
          agentLabel: 'Reviewer',
          agentModel: 'anthropic/claude-sonnet-4',
          agentColor: 'amber',
        },
      }),
      fromPartial({}),
      fromPartial({}),
    )

    if (!requestComponent || !turnComponent) {
      throw new Error('Expected Waggle renderer components')
    }

    expect(requestComponent.render(120)[0]).toContain('🐝')
    expect(turnComponent.render(120)[0]).toContain('🐝')
  })
})
