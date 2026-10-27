import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { isReadOnlyToolCall, observeRunWorkspaceMutations } from '../run-workspace-mutations'

function fakeSession() {
  const listeners = new Set<(event: AgentSessionEvent) => void>()
  const session: Pick<AgentSession, 'subscribe'> = {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const startTool = (toolName: string, args: unknown = {}) => {
    for (const listener of listeners)
      listener({ type: 'tool_execution_start', toolCallId: `${toolName}-call`, toolName, args })
  }
  return { session, startTool, listenerCount: () => listeners.size }
}

describe('isReadOnlyToolCall', () => {
  it.each([
    ['read', { path: 'a.ts' }],
    ['grep', { pattern: 'x' }],
    ['find', {}],
    ['ls', {}],
    ['openwaggle_docs', { action: 'read' }],
    ['preview_status', {}],
    ['preview_snapshot', {}],
    ['hive', { action: 'read' }],
    ['hive', { action: 'wait' }],
    ['project_actions', { action: 'runs' }],
    ['source_control', { action: 'status' }],
  ])('treats %s %j as read-only', (toolName, args) => {
    expect(isReadOnlyToolCall(toolName, args)).toBe(true)
  })

  it.each([
    ['write', { path: 'a.ts' }],
    ['edit', { path: 'a.ts' }],
    ['bash', { command: 'ls' }],
    ['powershell', { command: 'dir' }],
    ['codemode', { code: 'return 1' }],
    ['mcp__docs__search', { query: 'x' }],
    ['tool_search', { query: 'x' }],
    ['some_extension_tool', {}],
    ['preview_click', { locator: 'button' }],
    ['hive', { action: 'spawn' }],
    ['hive', { action: 'steer' }],
    ['hive', {}],
    ['hive', 'read'],
    ['project_actions', { action: 'start' }],
    ['source_control', { action: 'configure' }],
  ])('treats %s %j as possibly mutating', (toolName, args) => {
    expect(isReadOnlyToolCall(toolName, args)).toBe(false)
  })
})

describe('observeRunWorkspaceMutations', () => {
  it('reports no change for a Run without tool calls', () => {
    const { session } = fakeSession()
    const observer = observeRunWorkspaceMutations(session, 'What does this do?')
    expect(observer.mayHaveChangedWorkspace()).toBe(false)
  })

  it('reports no change while every tool is read-only', () => {
    const { session, startTool } = fakeSession()
    const observer = observeRunWorkspaceMutations(session, 'Explain the module')
    startTool('read', { path: 'a.ts' })
    startTool('hive', { action: 'status' })
    expect(observer.mayHaveChangedWorkspace()).toBe(false)
  })

  it('reports a change after one mutating tool, even among read-only ones', () => {
    const { session, startTool } = fakeSession()
    const observer = observeRunWorkspaceMutations(session, 'Fix it')
    startTool('read', { path: 'a.ts' })
    startTool('bash', { command: 'pnpm test' })
    startTool('read', { path: 'b.ts' })
    expect(observer.mayHaveChangedWorkspace()).toBe(true)
  })

  it('treats a prompt that may run an extension command as a change', () => {
    const { session } = fakeSession()
    expect(observeRunWorkspaceMutations(session, '  /deploy now').mayHaveChangedWorkspace()).toBe(
      true,
    )
  })

  it('stops listening once disposed', () => {
    const { session, listenerCount } = fakeSession()
    const observer = observeRunWorkspaceMutations(session, 'x')
    expect(listenerCount()).toBe(1)
    observer.dispose()
    expect(listenerCount()).toBe(0)
  })
})
