import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
  ToolResultEvent,
} from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { forOpenWaggleMcpSurface, withOpenWaggleMcpGuidance } from '../mcp-openwaggle-surface'

type Handler = (event: unknown, ctx: ExtensionContext) => unknown

/** A Pi API that records handlers and commands, and runs handlers with recorded notices. */
function recordingPi() {
  const handlers = new Map<string, Handler[]>()
  const commands: string[] = []
  const notify = vi.fn<ExtensionUIContext['notify']>()
  const ctx = fromPartial<ExtensionContext>({ ui: fromPartial<ExtensionUIContext>({ notify }) })
  const pi = fromPartial<ExtensionAPI>({
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
      return () => undefined
    },
    registerCommand: (name: string) => {
      commands.push(name)
    },
    getAllTools: () => [],
  })
  const emit = async (event: string, payload: unknown = {}) => {
    const results: unknown[] = []
    for (const handler of handlers.get(event) ?? []) results.push(await handler(payload, ctx))
    return results
  }
  return { pi, notify, emit, commands }
}

function notifyingExtension(pi: ExtensionAPI) {
  pi.on('before_agent_start', (_event, ctx) => {
    ctx.ui.notify('MCP servers are still connecting.', 'info')
    ctx.ui.notify('Connecting.')
    ctx.ui.notify(
      'MCP servers need attention:\n  figma: needs sign-in\nRun /mcp to fix.',
      'warning',
    )
  })
  pi.on('session_start', (_event, ctx) => {
    ctx.ui.notify('Signed in to MCP server "figma".', 'info')
  })
}

function toolResult(text: string) {
  return fromPartial<ToolResultEvent>({
    type: 'tool_result',
    toolName: 'mcp__figma__get_file',
    content: [{ type: 'text', text }],
    isError: true,
  })
}

describe('forOpenWaggleMcpSurface', () => {
  it("drops only the info notices of Pi's prompt-start wait", async () => {
    const { pi, notify, emit } = recordingPi()
    await forOpenWaggleMcpSurface(notifyingExtension)(pi)

    await emit('before_agent_start')
    await emit('session_start')

    expect(notify.mock.calls).toEqual([
      [
        'MCP servers need attention:\n  figma: needs sign-in\nOpen Settings > MCP to fix this.',
        'warning',
      ],
      ['Signed in to MCP server "figma".', 'info'],
    ])
  })

  it("does not register Pi's /mcp command, and keeps the extension's other commands", async () => {
    const { pi, commands } = recordingPi()
    await forOpenWaggleMcpSurface((api) => {
      api.registerCommand('mcp', { handler: async () => {} })
      api.registerCommand('qa-other', { handler: async () => {} })
    })(pi)

    expect(commands).toEqual(['qa-other'])
  })

  it('points tool errors that ask for /mcp at Settings > MCP', async () => {
    const { pi, emit } = recordingPi()
    await forOpenWaggleMcpSurface(() => {})(pi)

    const [rewritten] = await emit(
      'tool_result',
      toolResult('MCP server "figma" requires sign-in. Run /mcp to sign in.'),
    )
    const [untouched] = await emit('tool_result', toolResult('File not found.'))

    expect(rewritten).toEqual({
      content: [
        { type: 'text', text: 'MCP server "figma" requires sign-in. Sign in from Settings > MCP.' },
      ],
    })
    expect(untouched).toBeUndefined()
  })

  it('keeps the structured content of a result whose text it rewrites, for MCP Apps', async () => {
    const { pi, emit } = recordingPi()
    await forOpenWaggleMcpSurface(() => {})(pi)
    const structuredContent = { content: [], isError: true }

    const [rewritten] = await emit('tool_result', {
      ...toolResult('Run /mcp to fix.'),
      structuredContent,
    })

    expect(rewritten).toEqual({
      content: [{ type: 'text', text: 'Open Settings > MCP to fix this.' }],
      structuredContent,
    })
  })

  it('leaves the rest of the Pi API as it is', async () => {
    const { pi } = recordingPi()
    let tools: unknown
    await forOpenWaggleMcpSurface((api) => {
      tools = api.getAllTools()
    })(pi)

    expect(tools).toEqual([])
  })
})

describe('withOpenWaggleMcpGuidance', () => {
  it("replaces Pi's terminal commands with the Settings sections that do the same", () => {
    expect(withOpenWaggleMcpGuidance('Run /mcp to fix.')).toBe('Open Settings > MCP to fix this.')
    expect(withOpenWaggleMcpGuidance('Run /mcp to sign in.')).toBe('Sign in from Settings > MCP.')
    expect(
      withOpenWaggleMcpGuidance(
        'MCP server "docs" requires sign-in. Run /login github to sign in.',
      ),
    ).toBe('MCP server "docs" requires sign-in. Sign in to github from Settings > Connections.')
  })

  it('leaves other text alone', () => {
    expect(withOpenWaggleMcpGuidance('See https://example.com/mcp for help.')).toBe(
      'See https://example.com/mcp for help.',
    )
  })
})
