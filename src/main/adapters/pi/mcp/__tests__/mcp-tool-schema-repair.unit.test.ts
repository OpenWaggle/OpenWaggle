import { describe, expect, it } from 'vitest'
import { repairMcpToolListResult } from '../mcp-tool-schema-repair'

const UNION = {
  anyOf: [
    { type: 'object', properties: { id: { type: 'string' } } },
    { type: 'object', properties: { query: { type: 'string' } } },
  ],
}

describe('repairMcpToolListResult', () => {
  it('gives a root-anyOf tool an object root and keeps the rest of the tool', () => {
    const result = repairMcpToolListResult('docs', 'tools/list', {
      tools: [{ name: 'find', inputSchema: UNION, _meta: { ui: { resourceUri: 'ui://find' } } }],
      nextCursor: 'next',
    })

    expect(result).toMatchObject({
      nextCursor: 'next',
      tools: [
        {
          name: 'find',
          _meta: { ui: { resourceUri: 'ui://find' } },
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' }, query: { type: 'string' } },
          },
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('anyOf')
  })

  it('returns schemas providers accept, and other results, unchanged', () => {
    const tool = { name: 'ok', inputSchema: { type: 'object', properties: {} } }
    const list = { tools: [tool] }
    const repaired = repairMcpToolListResult('docs', 'tools/list', list)
    const call = { content: [], inputSchema: UNION }

    expect(repaired).toEqual(list)
    expect(repairMcpToolListResult('docs', 'tools/call', call)).toBe(call)
  })
})
