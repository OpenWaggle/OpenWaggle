import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { createRunSessionsExtension } from '../pi-agent-kernel-run'

function api() {
  return {
    registerTool: vi.fn(),
    on: vi.fn(() => () => undefined),
  }
}

function events(pi: ReturnType<typeof api>) {
  return pi.on.mock.calls.map((call: unknown[]) => call[0])
}

describe('createRunSessionsExtension', () => {
  const run = { runId: 'run-1', session: { id: SessionId('session-1') } }

  it('adds the available_agents section beside the hive tool for a Session that can spawn', () => {
    const pi = api()
    createRunSessionsExtension(
      { ...run, sessionCapabilities: ['sessions:spawn'] },
      '/repo/worktree',
      '/repo',
      undefined,
    )(fromPartial<ExtensionAPI>(pi))

    expect(pi.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'hive' }))
    expect(events(pi)).toEqual(['before_agent_start'])
  })

  it('registers only the hive tool for a Session that cannot start Sessions', () => {
    const pi = api()
    createRunSessionsExtension(
      { ...run, sessionCapabilities: ['sessions:read'] },
      '/repo',
      '/repo',
      undefined,
    )(fromPartial<ExtensionAPI>(pi))

    expect(pi.registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'hive' }))
    expect(events(pi)).toEqual([])
  })

  it('lists no definitions when the Agent definition allowlist leaves out hive', () => {
    const pi = api()
    createRunSessionsExtension(
      { ...run, toolAllowlist: ['read'] },
      '/repo',
      '/repo',
      undefined,
    )(fromPartial<ExtensionAPI>(pi))

    expect(events(pi)).toEqual([])
  })
})
