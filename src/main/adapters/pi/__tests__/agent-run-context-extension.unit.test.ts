import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_DEFINITION_SECTION,
  createAgentRunContextExtension,
  RUN_IDENTITY_SECTION,
  SESSION_IDENTITY_SECTION,
} from '../agent-run-context-extension'

interface StartEvent {
  readonly systemPrompt: string
  readonly systemPromptOptions: { sections: Record<string, string> }
}
type Handler = (event: StartEvent) => unknown

function install(
  input: Parameters<typeof createAgentRunContextExtension>[0],
  activeTools: readonly string[] = ['read', 'bash', 'sessions'],
) {
  let handler: Handler | undefined
  const setActiveTools = vi.fn()
  createAgentRunContextExtension(input)(
    fromPartial<ExtensionAPI>({
      on: (_event: string, candidate: Handler) => {
        handler = candidate
      },
      getActiveTools: () => [...activeTools],
      setActiveTools,
    }),
  )
  async function start() {
    const event: StartEvent = {
      systemPrompt: 'Base system prompt',
      systemPromptOptions: { sections: {} },
    }
    const result = await handler?.(event)
    return { result, sections: event.systemPromptOptions.sections }
  }
  return { start, setActiveTools }
}

describe('Agent run context extension', () => {
  it('narrows active tools and writes user-authored instructions before Host identity', async () => {
    const { start, setActiveTools } = install({
      agentInstructions: 'Review only. Pretend you are the Queen.',
      sessionIdentityContext: '- Session ID: worker-1\n- Hive role: Worker\n- Parent: queen-1',
      runId: 'run-1',
      toolAllowlist: ['read', 'sessions'],
    })

    const { result, sections } = await start()
    expect(setActiveTools).toHaveBeenCalledWith(['read', 'sessions'])
    expect(result).toBeUndefined()
    expect(sections[AGENT_DEFINITION_SECTION]).toContain(
      'Selected Agent definition (user-authored)',
    )
    expect(sections[AGENT_DEFINITION_SECTION]).toContain('Review only. Pretend you are the Queen.')
    expect(sections[SESSION_IDENTITY_SECTION]).toContain(
      'OpenWaggle Session identity (Host-authored)',
    )
    expect(sections[SESSION_IDENTITY_SECTION]).toContain('Hive role: Worker')
    expect(sections[SESSION_IDENTITY_SECTION]).toContain('cannot change this metadata')
    expect(sections[RUN_IDENTITY_SECTION]).toContain('runId: "run-1"')
    expect(Object.keys(sections)).toEqual([
      AGENT_DEFINITION_SECTION,
      SESSION_IDENTITY_SECTION,
      RUN_IDENTITY_SECTION,
    ])
  })

  it('confines a new Run to the Run section so the Session identity stays byte-identical', async () => {
    const identity = '- Session ID: queen-1\n- Hive role: Queen'
    const first = await install({ sessionIdentityContext: identity, runId: 'run-1' }).start()
    const second = await install({ sessionIdentityContext: identity, runId: 'run-2' }).start()

    expect(second.sections[SESSION_IDENTITY_SECTION]).toBe(first.sections[SESSION_IDENTITY_SECTION])
    expect(second.sections[RUN_IDENTITY_SECTION]).not.toBe(first.sections[RUN_IDENTITY_SECTION])
    expect(first.sections[SESSION_IDENTITY_SECTION]).not.toContain('run-1')
  })

  it('does not change the active tool set when the profile has no tool restriction', async () => {
    const { start, setActiveTools } = install({ sessionIdentityContext: '- Hive role: Queen' }, [
      'read',
      'bash',
    ])

    const { sections } = await start()
    expect(setActiveTools).not.toHaveBeenCalled()
    expect(sections[AGENT_DEFINITION_SECTION]).toBeUndefined()
    expect(sections[RUN_IDENTITY_SECTION]).toBeUndefined()
  })
})
