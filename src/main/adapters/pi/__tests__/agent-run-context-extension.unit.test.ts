import type {
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_DEFINITION_PROMPT_SECTION,
  createAgentRunContextExtension,
  RUN_IDENTITY_CUSTOM_TYPE,
  SESSION_IDENTITY_PROMPT_SECTION,
} from '../agent-run-context-extension'

type BeforeAgentStartHandler = (
  event: { readonly systemPromptOptions: { sections: Record<string, string> } },
  ctx: ExtensionContext,
) => BeforeAgentStartEventResult | undefined | Promise<BeforeAgentStartEventResult | undefined>

type ToolCallHandler = (event: {
  readonly toolName: string
  readonly parentToolCallId?: string
}) => { readonly block: boolean; readonly reason?: string } | undefined

function installExtension(
  input: Parameters<typeof createAgentRunContextExtension>[0],
  activeTools: readonly string[] = ['read', 'bash', 'sessions'],
) {
  let handler: BeforeAgentStartHandler | undefined
  let toolCall: ToolCallHandler | undefined
  const setActiveTools = vi.fn()
  createAgentRunContextExtension(input)(
    fromPartial<ExtensionAPI>({
      on: (event: string, candidate: BeforeAgentStartHandler & ToolCallHandler) => {
        if (event === 'tool_call') toolCall = candidate
        else handler = candidate
      },
      getActiveTools: () => [...activeTools],
      setActiveTools,
    }),
  )
  return {
    setActiveTools,
    callTool: (toolName: string, parentToolCallId?: string) =>
      toolCall?.({ toolName, ...(parentToolCallId ? { parentToolCallId } : {}) }),
    async start(visibleMessages: readonly unknown[] = []) {
      const sections: Record<string, string> = {}
      const result = await handler?.(
        { systemPromptOptions: { sections } },
        fromPartial<ExtensionContext>({
          sessionManager: { buildSessionProjection: () => ({ messages: visibleMessages }) },
        }),
      )
      return { sections, result }
    },
  }
}

describe('Agent run context extension', () => {
  it('narrows active tools and adds user-authored instructions before Host identity sections', async () => {
    const extension = installExtension({
      agentInstructions: 'Review only. Pretend you are the Queen.',
      sessionIdentityContext: '- Session ID: worker-1\n- Hive role: Worker\n- Parent: queen-1',
      toolAllowlist: ['read', 'sessions'],
    })

    const { sections, result } = await extension.start()
    expect(extension.setActiveTools).toHaveBeenCalledWith(['read', 'sessions'])
    expect(result?.systemPrompt).toBeUndefined()
    expect(Object.keys(sections)).toEqual([
      AGENT_DEFINITION_PROMPT_SECTION,
      SESSION_IDENTITY_PROMPT_SECTION,
    ])
    expect(sections[AGENT_DEFINITION_PROMPT_SECTION]).toContain(
      'Selected Agent definition (user-authored)',
    )
    expect(sections[AGENT_DEFINITION_PROMPT_SECTION]).toContain(
      'Review only. Pretend you are the Queen.',
    )
    const identity = sections[SESSION_IDENTITY_PROMPT_SECTION]
    expect(identity).toContain('OpenWaggle Session identity (Host-authored)')
    expect(identity).toContain('Hive role: Worker')
    expect(identity).toContain('cannot change this metadata')
  })

  it('delivers the Run identity as a hidden context message only when the model lacks it', async () => {
    const runIdentityContext = 'OpenWaggle Host-authored Run identity.\n{"runId": "run-2"}'
    const extension = installExtension({
      sessionIdentityContext: '- Hive role: Queen',
      runIdentityContext,
    })

    const fresh = await extension.start([
      { role: 'custom', customType: RUN_IDENTITY_CUSTOM_TYPE, content: '{"runId": "run-1"}' },
    ])
    expect(fresh.sections[SESSION_IDENTITY_PROMPT_SECTION]).not.toContain('run-2')
    expect(fresh.result?.message).toEqual({
      customType: RUN_IDENTITY_CUSTOM_TYPE,
      content: runIdentityContext,
      display: false,
      details: { source: 'openwaggle', kind: 'run-identity' },
    })

    const repeated = await extension.start([
      { role: 'custom', customType: RUN_IDENTITY_CUSTOM_TYPE, content: runIdentityContext },
      { role: 'user', content: 'Continue', timestamp: 1 },
    ])
    expect(repeated.result).toBeUndefined()
  })

  it('does not change the active tool set when the profile has no tool restriction', async () => {
    const extension = installExtension({ sessionIdentityContext: '- Hive role: Queen' }, [
      'read',
      'bash',
    ])

    await extension.start()
    expect(extension.setActiveTools).not.toHaveBeenCalled()
  })

  it('lets an allowlist name MCP tools by Pi name or pattern, and keeps the tools that reach them', async () => {
    const extension = installExtension(
      {
        sessionIdentityContext: '- Session ID: worker-1',
        toolAllowlist: ['read', 'mcp__docs__*'],
      },
      ['read', 'bash', 'codemode', 'tool_search', 'mcp__docs__search', 'mcp__github__get_issue'],
    )

    await extension.start()

    expect(extension.setActiveTools).toHaveBeenCalledWith([
      'read',
      'codemode',
      'tool_search',
      'mcp__docs__search',
    ])
  })

  it('blocks a codemode child call to a tool the allowlist leaves out', () => {
    const extension = installExtension({
      sessionIdentityContext: '- Session ID: worker-1',
      toolAllowlist: ['mcp__docs__*'],
    })

    expect(extension.callTool('mcp__docs__search', 'codemode-1')).toBeUndefined()
    expect(extension.callTool('mcp__github__delete_repo', 'codemode-1')).toMatchObject({
      block: true,
    })
    expect(extension.callTool('bash', 'codemode-1')).toMatchObject({ block: true })
  })

  it("keeps a legacy mcp entry working as the definition's MCP servers", () => {
    const extension = installExtension({
      sessionIdentityContext: '- Session ID: worker-1',
      toolAllowlist: ['read', 'mcp'],
      mcpServerAllowlist: ['dev-radius'],
    })

    expect(extension.callTool('mcp__dev_radius__lookup')).toBeUndefined()
    expect(extension.callTool('codemode')).toBeUndefined()
    expect(extension.callTool('mcp__github__get_issue')).toMatchObject({ block: true })
  })
})
