import { describe, expect, it } from 'vitest'
import { toolKind } from '../tool-kind'

describe('toolKind', () => {
  it('groups Pi and OpenWaggle tools by family', () => {
    expect(toolKind('sessions')).toBe('workers')
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
    expect(toolKind('update_goal')).toBe('goals')
    expect(toolKind('set_goal_tasks')).toBe('goals')
    expect(toolKind('propose_goal_draft')).toBe('goals')
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
    // OpenWaggle's former gateway, in older transcripts.
    expect(toolKind('mcp')).toBe('mcp')
    expect(toolKind('mcp_run')).toBe('mcp')
  })

  it('falls back for anything else, a script model call included', () => {
    expect(toolKind('models.classify')).toBe('other')
    expect(toolKind('my_extension_tool')).toBe('other')
    expect(toolKind('mcp__')).toBe('other')
    expect(toolKind('toString')).toBe('other')
  })
})
