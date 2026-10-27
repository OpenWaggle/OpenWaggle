import type { Context, SystemMessage, Tool } from '@earendil-works/pi-ai'
import { collapseSystemMessages, normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { describe, expect, it } from 'vitest'

/**
 * Providers without mid-conversation tool changes (Bedrock, most others) get one leading system
 * message with the current tools. Pi replayed the tool deltas in insertion order, so an MCP
 * server that reconnected during a Run put its tools at the end, in whatever order the servers
 * connected, and the same tool set serialized differently: every such Run rewrote the whole
 * prompt cache.
 */

function tool(name: string): Tool {
  return { name, description: `${name} tool`, parameters: { type: 'object', properties: {} } }
}

function system(message: Omit<SystemMessage, 'role' | 'timestamp' | 'content'>): SystemMessage {
  return { role: 'system', content: '', timestamp: 0, ...message }
}

function collapsedToolNames(messages: Context['messages']) {
  const head = collapseSystemMessages(normalizeContext({ messages })).messages[0]
  return head?.role === 'system' ? (head.toolsAdded ?? []).map((entry) => entry.name) : []
}

const LEADING = system({
  toolsAdded: [tool('read'), tool('bash'), tool('mcp__figma__get'), tool('mcp__browser__click')],
})

describe('collapsed tool order', () => {
  it('is the same after MCP tools are removed and added again in another order', () => {
    const stable = collapsedToolNames([LEADING])
    const flapped = collapsedToolNames([
      LEADING,
      system({ toolsRemoved: [{ name: 'mcp__figma__get' }, { name: 'mcp__browser__click' }] }),
      system({ toolsAdded: [tool('mcp__browser__click')] }),
      system({ toolsAdded: [tool('mcp__figma__get')] }),
    ])

    expect(flapped).toEqual(stable)
    expect(stable).toEqual(['read', 'bash', 'mcp__figma__get', 'mcp__browser__click'])
  })

  it('lists tools added after the leading message by name, whatever order they arrived in', () => {
    const first = collapsedToolNames([
      LEADING,
      system({ toolsAdded: [tool('mcp__zeta__a'), tool('mcp__alpha__b')] }),
    ])
    const second = collapsedToolNames([
      LEADING,
      system({ toolsAdded: [tool('mcp__alpha__b')] }),
      system({ toolsAdded: [tool('mcp__zeta__a')] }),
    ])

    expect(first).toEqual(second)
    expect(first.slice(-2)).toEqual(['mcp__alpha__b', 'mcp__zeta__a'])
  })

  it('drops removed tools and keeps the leading order for the rest', () => {
    expect(collapsedToolNames([LEADING, system({ toolsRemoved: [{ name: 'bash' }] })])).toEqual([
      'read',
      'mcp__figma__get',
      'mcp__browser__click',
    ])
  })
})
