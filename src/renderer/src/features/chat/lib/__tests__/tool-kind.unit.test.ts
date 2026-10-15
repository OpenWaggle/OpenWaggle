import { describe, expect, it } from 'vitest'
import { parseMcpToolName, toolKind } from '../tool-kind'

describe('toolKind', () => {
  it('groups Pi and OpenWaggle tools by family', () => {
    expect(toolKind('sessions')).toBe('subagents')
    expect(toolKind('codemode')).toBe('script')
    expect(toolKind('bash')).toBe('shell')
    expect(toolKind('powershell')).toBe('shell')
    expect(toolKind('read')).toBe('read')
    expect(toolKind('edit')).toBe('edit')
    expect(toolKind('write')).toBe('write')
    expect(toolKind('grep')).toBe('grep')
    expect(toolKind('find')).toBe('find')
    expect(toolKind('ls')).toBe('ls')
    expect(toolKind('project_actions')).toBe('actions')
    expect(toolKind('source_control')).toBe('scm')
    expect(toolKind('create_goal')).toBe('goals')
    expect(toolKind('get_goal')).toBe('goals')
    expect(toolKind('waggle_invoke')).toBe('waggle')
  })

  it('treats every browser preview tool as one family', () => {
    expect(toolKind('preview_click')).toBe('browser')
    expect(toolKind('preview_recording_stop')).toBe('browser')
  })

  it('treats MCP tools and the tools that reach MCP servers as MCP', () => {
    expect(toolKind('mcp__datadog__analyze_datadog_logs')).toBe('mcp')
    expect(toolKind('list_mcp_resources')).toBe('mcp')
    expect(toolKind('list_mcp_resource_templates')).toBe('mcp')
    expect(toolKind('read_mcp_resource')).toBe('mcp')
    expect(toolKind('tool_search')).toBe('mcp')
  })

  it('marks a script model call and falls back for anything else', () => {
    expect(toolKind('models.classify')).toBe('model')
    expect(toolKind('my_extension_tool')).toBe('other')
    expect(toolKind('mcp__')).toBe('other')
    expect(toolKind('toString')).toBe('other')
  })
})

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
