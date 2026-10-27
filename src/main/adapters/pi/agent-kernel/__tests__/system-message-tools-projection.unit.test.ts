import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { projectionForPiEntry } from '../entry-projections'

function base(id: string) {
  return { id, parentId: null, timestamp: '2026-05-19T10:00:00.000Z' }
}

describe('system message tool projection (D7.3)', () => {
  it("keeps a system message's tool names and a digest, not every tool schema", () => {
    const schema = { type: 'object', properties: { path: { type: 'string' } } }
    const tools = [
      { name: 'read', description: 'Read a file. '.repeat(500), parameters: schema },
      { name: 'bash', description: 'Run a command. '.repeat(500), parameters: schema },
    ]
    const entry = (toolsAdded: typeof tools) =>
      ({
        ...base('system-tools'),
        type: 'message',
        message: { role: 'system', content: '', toolsAdded, timestamp: 1 },
      }) satisfies SessionEntry
    const projected = projectionForPiEntry(entry(tools))
    const content = JSON.parse(projected.contentJson)

    expect(content.toolsAdded).toEqual([{ name: 'read' }, { name: 'bash' }])
    expect(content.toolsAddedDigest).toMatch(/^[0-9a-f]{64}$/u)
    expect(projected.contentJson.length).toBeLessThan(300)
    // The same tool set projects the same digest; a changed definition a different one.
    expect(JSON.parse(projectionForPiEntry(entry(tools)).contentJson).toolsAddedDigest).toBe(
      content.toolsAddedDigest,
    )
    const changed = [{ ...tools[0], description: 'Read.' }, tools[1]].filter(
      (tool) => tool !== undefined,
    )
    expect(JSON.parse(projectionForPiEntry(entry(changed)).contentJson).toolsAddedDigest).not.toBe(
      content.toolsAddedDigest,
    )
  })
})
