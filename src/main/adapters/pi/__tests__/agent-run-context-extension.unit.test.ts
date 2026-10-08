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
  createAgentToolAllowlistGuard,
  RUN_IDENTITY_CUSTOM_TYPE,
  SESSION_IDENTITY_PROMPT_SECTION,
} from '../agent-run-context-extension'

type BeforeAgentStartHandler = (
  event: { readonly systemPromptOptions: { sections: Record<string, string> } },
  ctx: ExtensionContext,
) => BeforeAgentStartEventResult | undefined | Promise<BeforeAgentStartEventResult | undefined>

type ContextHandler = (
  event: { readonly messages: readonly unknown[] },
  ctx: ExtensionContext,
) => { readonly messages?: readonly unknown[] } | undefined

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
  let context: ContextHandler | undefined
  const setActiveTools = vi.fn()
  const appendEntry = vi.fn()
  const pi = fromPartial<ExtensionAPI>({
    on: (event: string, candidate: BeforeAgentStartHandler & ToolCallHandler & ContextHandler) => {
      if (event === 'tool_call') toolCall = candidate
      if (event === 'context') context = candidate
      if (event === 'before_agent_start') handler = candidate
    },
    getActiveTools: () => [...activeTools],
    setActiveTools,
    appendEntry,
  })
  // A Run loads the guard first and the context extension later (classic-run.ts).
  createAgentToolAllowlistGuard(input)?.(pi)
  createAgentRunContextExtension(input)(pi)
  return {
    setActiveTools,
    appendEntry,
    context: (messages: readonly unknown[], branch: readonly unknown[]) =>
      context?.(
        { messages },
        fromPartial<ExtensionContext>({ sessionManager: { getBranch: () => branch } }),
      ),
    callTool: (toolName: string, parentToolCallId?: string) =>
      toolCall?.({ toolName, ...(parentToolCallId ? { parentToolCallId } : {}) }),
    async start(branch: readonly unknown[] = []) {
      const sections: Record<string, string> = {}
      const result = await handler?.(
        { systemPromptOptions: { sections } },
        fromPartial<ExtensionContext>({ sessionManager: { getBranch: () => branch } }),
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

  it('stores the Run identity as a plain entry only when it differs from the latest one', async () => {
    const runIdentityContext = 'OpenWaggle Host-authored Run identity.\n{"runId": "run-2"}'
    const extension = installExtension({
      sessionIdentityContext: '- Hive role: Queen',
      runIdentityContext,
    })
    const identityEntry = (content: string) => ({
      type: 'custom',
      customType: RUN_IDENTITY_CUSTOM_TYPE,
      data: { content },
      timestamp: '2026-10-08T10:00:00.000Z',
    })

    const fresh = await extension.start([identityEntry('{"runId": "run-1"}')])
    expect(fresh.sections[SESSION_IDENTITY_PROMPT_SECTION]).not.toContain('run-2')
    expect(fresh.result).toBeUndefined()
    expect(extension.appendEntry).toHaveBeenCalledWith(RUN_IDENTITY_CUSTOM_TYPE, {
      content: runIdentityContext,
    })

    extension.appendEntry.mockClear()
    await extension.start([identityEntry(runIdentityContext)])
    // A file from before stores it as a context message.
    await extension.start([
      {
        type: 'custom_message',
        customType: RUN_IDENTITY_CUSTOM_TYPE,
        content: runIdentityContext,
        timestamp: '2026-10-08T10:00:00.000Z',
      },
    ])
    expect(extension.appendEntry).not.toHaveBeenCalled()
  })

  it("sends each stored Run identity to the model after its Run's prompt", () => {
    const extension = installExtension({ sessionIdentityContext: '- Hive role: Queen' })
    const at = (ms: number) => new Date(ms).toISOString()
    const branch = [
      {
        type: 'custom',
        customType: RUN_IDENTITY_CUSTOM_TYPE,
        data: { content: 'run-1' },
        timestamp: at(10),
      },
      {
        type: 'custom',
        customType: RUN_IDENTITY_CUSTOM_TYPE,
        data: { content: 'run-2' },
        timestamp: at(30),
      },
    ]
    const messages = [
      { role: 'user', content: 'First', timestamp: 11 },
      { role: 'assistant', content: [], timestamp: 12 },
      { role: 'user', content: 'Second', timestamp: 31 },
    ]

    const result = extension.context(messages, branch)

    expect(result?.messages).toMatchObject([
      { content: 'First' },
      { content: 'run-1' },
      { content: [] },
      { content: 'Second' },
      { content: 'run-2' },
    ])
    expect(result?.messages?.[1]).toMatchObject({ role: 'custom', display: false, timestamp: 10 })
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
