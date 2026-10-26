import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(), getVersion: vi.fn(() => 'test') },
}))

import {
  ACTIVE_CREDENTIAL,
  createMcpConformanceHost,
} from './openwaggle-mcp-server-conformance.test-support'
import {
  advertisedOperations,
  listedSessionIds,
} from './openwaggle-mcp-server-conformance-results.test-support'

describe('OpenWaggle as an MCP server: protocol conformance (#350)', () => {
  const host = createMcpConformanceHost()
  beforeEach(() => host.start())
  afterEach(() => host.stop())

  it.each([['2025-11-25'], ['2025-06-18'], ['2026-07-28']])(
    'initializes with protocol %s and identifies itself',
    async (version) => {
      const client = await host.connect(host.serveOptions(), [version])

      expect(client.getNegotiatedProtocolVersion()).toBe(version)
      expect(client.getServerVersion()).toMatchObject({
        name: 'OpenWaggle',
        version: 'conformance',
      })
      expect(client.getServerCapabilities()).toMatchObject({
        tools: expect.any(Object),
        resources: expect.any(Object),
        prompts: expect.any(Object),
      })
    },
  )

  it('lists only openwaggle_hive, advertising only the granted operations', async () => {
    const client = await host.connect(host.serveOptions())
    const { tools } = await client.listTools()

    expect(tools.map((tool) => tool.name)).toEqual(['openwaggle_hive'])
    const [tool] = tools
    if (!tool) throw new Error('openwaggle_hive is missing.')
    expect(advertisedOperations(tool)).toEqual([
      'agent-definitions-list',
      'agent-definitions-search',
      'list',
      'search',
    ])
    expect(tool.description).toContain('sessions:discover')
  })

  it('answers tools/call with the canonical result in text and structured content', async () => {
    const client = await host.connect(host.serveOptions())
    const result = await client.callTool({
      name: 'openwaggle_hive',
      arguments: { operation: 'list' },
    })

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({
      contract: 'session-query-v2',
      response: { outcome: { operation: 'list' } },
    })
    const [content] = Array.isArray(result.content) ? result.content : []
    expect(JSON.parse(String(Reflect.get(Object(content), 'text')))).toEqual(
      result.structuredContent,
    )
    await expect(listedSessionIds(client)).resolves.toEqual(['session-a', 'session-b'])
  })

  it('returns tool errors for an ungranted operation, a bad argument, and a missing grant', async () => {
    const client = await host.connect(host.serveOptions())
    const ungranted = await client.callTool({
      name: 'openwaggle_hive',
      arguments: { operation: 'read', sessionId: 'session-a' },
    })
    const unknownField = await client.callTool({
      name: 'openwaggle_hive',
      arguments: { operation: 'list', typo: true },
    })
    const missingGrant = await client.callTool({
      name: 'openwaggle_hive',
      arguments: { operation: 'search', message: 'x', fullTranscript: true },
    })

    expect(ungranted.isError).toBe(true)
    // Not offered, but the error still names the grant to add (#350).
    expect(JSON.stringify(ungranted.content)).toContain(
      'This MCP server was started without --grant sessions:read, which read needs.',
    )
    expect(unknownField.isError).toBe(true)
    expect(missingGrant.isError).toBe(true)
    expect(JSON.stringify(missingGrant.content)).toContain(
      'This MCP server was started without --grant sessions:read, which search needs.',
    )
    expect(host.dispatchedCallers()).toEqual([])
  })

  it('does not serve the former openwaggle_sessions tool name', async () => {
    const client = await host.connect(host.serveOptions())
    const result = await client
      .callTool({ name: 'openwaggle_sessions', arguments: { operation: 'list' } })
      .then(
        (value) => ({ rejected: false, value }),
        (error: unknown) => ({ rejected: true, value: error }),
      )

    expect(result.rejected || Reflect.get(Object(result.value), 'isError') === true).toBe(true)
    const detail =
      result.value instanceof Error ? result.value.message : JSON.stringify(result.value)
    expect(detail).toMatch(/openwaggle_sessions/)
    expect(host.dispatchedCallers()).toEqual([])
  })

  it('describes its authority in the caller capabilities resource', async () => {
    const client = await host.connect(
      host.serveOptions({ identity: host.profileIdentity('repo-a-reviewer', ACTIVE_CREDENTIAL) }),
    )
    const resource = await client.readResource({ uri: 'openwaggle://caller/capabilities' })
    const [content] = resource.contents

    expect(JSON.parse(String(Reflect.get(Object(content), 'text')))).toMatchObject({
      authority: 'profile',
      profile: 'repo-a-reviewer',
      grants: ['sessions:discover'],
    })
  })
})
