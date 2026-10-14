import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { withoutMcpStartupNotice } from '../mcp-quiet-startup'

type Handler = (event: unknown, ctx: ExtensionContext) => unknown

/** A Pi API that records handlers, and runs them with a context whose notices are recorded. */
function recordingPi() {
  const handlers = new Map<string, Handler>()
  const notify = vi.fn<ExtensionUIContext['notify']>()
  const ctx = fromPartial<ExtensionContext>({ ui: fromPartial<ExtensionUIContext>({ notify }) })
  const pi = fromPartial<ExtensionAPI>({
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler)
      return () => undefined
    },
    getAllTools: () => [],
  })
  const emit = (event: string) => handlers.get(event)?.({}, ctx)
  return { pi, notify, emit }
}

function notifyingExtension(pi: ExtensionAPI) {
  pi.on('before_agent_start', (_event, ctx) => {
    ctx.ui.notify('MCP servers are still connecting.', 'info')
    ctx.ui.notify('Connecting.')
    ctx.ui.notify('MCP servers need attention.', 'warning')
  })
  pi.on('session_start', (_event, ctx) => {
    ctx.ui.notify('Signed in to MCP server "figma".', 'info')
  })
}

describe('withoutMcpStartupNotice', () => {
  it("drops only the info notices of Pi's prompt-start wait", async () => {
    const { pi, notify, emit } = recordingPi()
    await withoutMcpStartupNotice(notifyingExtension)(pi)

    await emit('before_agent_start')
    await emit('session_start')

    expect(notify.mock.calls).toEqual([
      ['MCP servers need attention.', 'warning'],
      ['Signed in to MCP server "figma".', 'info'],
    ])
  })

  it('leaves the rest of the Pi API as it is', async () => {
    const { pi } = recordingPi()
    let tools: unknown
    await withoutMcpStartupNotice((api) => {
      tools = api.getAllTools()
    })(pi)

    expect(tools).toEqual([])
  })
})
