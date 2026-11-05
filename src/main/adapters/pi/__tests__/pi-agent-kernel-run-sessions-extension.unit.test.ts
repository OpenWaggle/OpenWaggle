import type { BeforeAgentStartEvent, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { discoverAgentDefinitions } from '../../../agents/agent-definition-discovery'
import { AVAILABLE_AGENTS_PROMPT_SECTION } from '../available-agents-prompt'
import { createRunSessionsExtension } from '../pi-agent-kernel-run'

vi.mock('../../../agents/agent-definition-discovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../agents/agent-definition-discovery')>()),
  discoverAgentDefinitions: vi.fn(async () => ({
    definitions: [
      { name: 'reviewer', description: 'Reviews merge requests.', scope: 'project', valid: true },
    ],
  })),
}))

function api() {
  return {
    registerTool: vi.fn(),
    on: vi.fn<(event: string, handler: (event: BeforeAgentStartEvent) => unknown) => () => void>(
      () => () => undefined,
    ),
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

  it('lists the definitions of the Session’s project, not its worktree, with its toggles', async () => {
    const pi = api()
    createRunSessionsExtension(
      {
        ...run,
        sessionCapabilities: ['sessions:spawn'],
        agentDefinitionToggles: { planner: false },
      },
      '/repo/worktree',
      '/repo',
      undefined,
    )(fromPartial<ExtensionAPI>(pi))
    const sections: Record<string, string> = {}
    const handler = pi.on.mock.calls[0]?.[1]
    await handler?.(fromPartial<BeforeAgentStartEvent>({ systemPromptOptions: { sections } }))

    // The Host resolves spawn's agent against projectPath with the project's toggles.
    expect(discoverAgentDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: '/repo', enabledByName: { planner: false } }),
    )
    expect(sections[AVAILABLE_AGENTS_PROMPT_SECTION]).toContain('<agent name="reviewer">')
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
