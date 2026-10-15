import { describe, expect, it } from 'vitest'
import { isMcpServerReachToolName, parseMcpToolName } from '../mcp-tool-names'

describe('parseMcpToolName', () => {
  it('splits at the first separator after the prefix', () => {
    expect(parseMcpToolName('mcp__chrome_devtools__take_screenshot')).toEqual({
      server: 'chrome_devtools',
      tool: 'take_screenshot',
    })
    expect(parseMcpToolName('mcp__docs__search__v2')).toEqual({
      server: 'docs',
      tool: 'search__v2',
    })
  })

  it('rejects names without a server or a tool', () => {
    expect(parseMcpToolName('read')).toBeNull()
    expect(parseMcpToolName('mcp____tool')).toBeNull()
    expect(parseMcpToolName('mcp__docs__')).toBeNull()
    expect(parseMcpToolName('mcp__docs')).toBeNull()
  })
})

describe('isMcpServerReachToolName', () => {
  it('names the Pi tools that reach MCP servers', () => {
    expect(isMcpServerReachToolName('tool_search')).toBe(true)
    expect(isMcpServerReachToolName('read_mcp_resource')).toBe(true)
    expect(isMcpServerReachToolName('codemode')).toBe(false)
  })
})
