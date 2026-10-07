import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const recorded = vi.hoisted((): unknown[] => [])

vi.mock('../../../../usage-statistics/usage-statistics-enablement', () => ({
  isUsageStatisticsEnabled: () => true,
}))
vi.mock('../../../../usage-statistics/usage-statistics-recorder', () => ({
  recordUsageStatistics: (observation: unknown) => recorded.push(observation),
}))

const { registerMcpUsageStatistics } = await import('../mcp-usage-statistics')

type Handler = (event: { readonly toolName: string }) => void

function runWith(servers: Record<string, Record<string, unknown>>) {
  let handler: Handler | undefined
  const pi = fromPartial<ExtensionAPI>({
    on: (event: string, listener: Handler) => {
      if (event === 'tool_execution_start') handler = listener
    },
    // Pi registers `chrome-devtools`' tools as `mcp__chrome_devtools__*`.
    getAllTools: () => [
      {
        name: 'mcp__chrome_devtools__take_screenshot',
        namespace: { name: 'mcp__chrome_devtools' },
      },
    ],
  })
  registerMcpUsageStatistics(
    pi,
    fromPartial({
      loaded: {
        servers: Object.entries(servers).map(([name, config]) => ({ name, config })),
      },
    }),
  )
  return (toolName: string) => handler?.({ toolName })
}

describe('MCP servers in Usage statistics', () => {
  beforeEach(() => {
    recorded.length = 0
  })

  it('names a catalog server Pi reports under its tool namespace', () => {
    const call = runWith({
      'chrome-devtools': { command: 'npx', args: ['chrome-devtools-mcp@latest'] },
    })

    call('mcp__chrome_devtools__take_screenshot')

    expect(recorded).toEqual([{ kind: 'mcp-server', identifier: 'chrome-devtools' }])
  })

  it("counts a user's own server with a catalog name as custom, from its configuration", () => {
    const call = runWith({ 'chrome-devtools': { command: 'node', args: ['/home/me/fork.js'] } })

    call('mcp__chrome_devtools__take_screenshot')
    call('read')

    expect(recorded).toEqual([{ kind: 'mcp-server', identifier: 'custom' }])
  })
})
