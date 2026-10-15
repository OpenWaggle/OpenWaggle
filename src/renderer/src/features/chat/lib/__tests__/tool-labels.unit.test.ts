import type { JsonObject } from '@shared/types/json'
import { describe, expect, it } from 'vitest'
import { openWaggleToolLabel } from '../tool-labels'

function labelOf(name: string, args: JsonObject = {}) {
  const label = openWaggleToolLabel(name, args)
  if (!label) throw new Error(`No label for ${name}`)
  return label
}

describe('openWaggleToolLabel', () => {
  it('names an MCP tool by its server', () => {
    expect(labelOf('mcp__datadog__analyze_datadog_logs')).toEqual({
      running: 'Datadog › analyze_datadog_logs...',
      done: 'Datadog › analyze_datadog_logs',
      requested: 'Requested Datadog › analyze_datadog_logs',
    })
    expect(labelOf('read_mcp_resource', { uri: 'figma://file/abc' }).done).toBe(
      'Read MCP resource figma://file/abc',
    )
    expect(labelOf('tool_search', { query: 'logs' }).done).toBe('Searched tools · logs')
  })

  it('describes browser preview actions', () => {
    expect(labelOf('preview_navigate', { url: 'localhost:5173' }).done).toBe(
      'Navigated to localhost:5173',
    )
    expect(
      labelOf('preview_navigate', { target: { kind: 'environment-port', port: 5173, path: '/a' } })
        .done,
    ).toBe('Navigated to port 5173/a')
    expect(
      labelOf('preview_navigate', { target: { kind: 'environment-port', port: 5173, path: 'a' } })
        .done,
    ).toBe('Navigated to port 5173/a')
    expect(labelOf('preview_navigate').done).toBe('Navigated browser preview')
    expect(labelOf('preview_click', { locator: 'role=button[name="Save"]' }).done).toBe(
      'Clicked role=button[name="Save"]',
    )
    expect(labelOf('preview_click', { x: 10, y: 20 }).done).toBe('Clicked (10, 20)')
    expect(labelOf('preview_press', { key: 'K', modifiers: ['Meta'] }).done).toBe('Pressed Meta+K')
    expect(labelOf('preview_resize', { mode: 'freeform', width: 800, height: 600 }).done).toBe(
      'Resized preview · 800×600',
    )
    expect(labelOf('preview_snapshot').running).toBe('Taking page snapshot...')
    expect(labelOf('preview_snapshot').requested).toBe('Requested browser preview')
  })

  it('describes project actions, source control, goals and Waggle', () => {
    expect(labelOf('project_actions', { action: 'start', actionId: 'dev' }).done).toBe(
      'Started project action · dev',
    )
    expect(labelOf('project_actions', { action: 'later' }).done).toBe('Project actions · later')
    expect(labelOf('source_control', { action: 'status' }).done).toBe('Checked source control')
    expect(labelOf('get_goal').done).toBe('Read goal')
    expect(labelOf('update_goal').running).toBe('Updating goal...')
    expect(labelOf('update_goal_task').done).toBe('Updated goal task')
    expect(labelOf('waggle_invoke', { preset: 'code-review' }).done).toBe(
      'Handed off to Waggle · code-review',
    )
  })

  it('shows a powershell command the way a bash command shows', () => {
    expect(labelOf('powershell', { command: 'dir' })).toEqual({
      running: 'Running `dir`',
      done: 'Ran `dir`',
      requested: 'Requested powershell `dir`',
    })
  })

  it('leaves Pi-native and unknown tools to their Pi names', () => {
    expect(openWaggleToolLabel('my_extension_tool', {})).toBeNull()
    expect(openWaggleToolLabel('preview_unknown', {})).toBeNull()
  })
})
