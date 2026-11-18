import { describe, expect, it } from 'vitest'
import { type McpConfigLayer, mergeMcpConfigLayers } from '../mcp-config-merge'

const PI_GLOBAL = '/home/u/.pi/agent/mcp.json'
const OW_GLOBAL = '/home/u/.openwaggle/mcp.json'

describe('whether an MCP merge saw every server', () => {
  it('is complete with an invalid entry, which it names', () => {
    const layers: McpConfigLayer[] = [
      {
        fileId: 'pi-global',
        path: PI_GLOBAL,
        content: {
          kind: 'parsed',
          value: { mcpServers: { docs: { command: 'docs' }, typo: { comand: 'x' } } },
        },
      },
    ]

    const merged = mergeMcpConfigLayers(layers)

    expect(merged.errors).not.toEqual([])
    expect(merged.incomplete).toBeUndefined()
    expect(merged.rejectedNames).toEqual(['typo'])
  })

  it('is incomplete while a file cannot be read', () => {
    const layers: McpConfigLayer[] = [
      { fileId: 'pi-global', path: PI_GLOBAL, content: { kind: 'missing' } },
      {
        fileId: 'openwaggle-global',
        path: OW_GLOBAL,
        content: { kind: 'unreadable', error: 'Unexpected token' },
      },
    ]

    expect(mergeMcpConfigLayers(layers).incomplete).toBe(true)
  })
})
