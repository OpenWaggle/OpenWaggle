import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(), getVersion: vi.fn(() => 'test') },
}))

import { verifyServeIdentity } from '../openwaggle-mcp-server'
import {
  ACTIVE_CREDENTIAL,
  createMcpConformanceHost,
  REVOKED_CREDENTIAL,
} from './openwaggle-mcp-server-conformance.test-support'
import { listedSessionIds } from './openwaggle-mcp-server-conformance-results.test-support'

describe('OpenWaggle MCP server named access profiles fail closed (#350)', () => {
  const host = createMcpConformanceHost()
  beforeEach(() => host.start())
  afterEach(() => host.stop())

  it('serves an active profile only where both the profile and the server reach', async () => {
    const client = await host.connect(
      host.serveOptions({ identity: host.profileIdentity('repo-a-reviewer', ACTIVE_CREDENTIAL) }),
    )

    await expect(listedSessionIds(client)).resolves.toEqual(['session-a'])
    expect(host.dispatchedCallers().at(-1)).toMatchObject({
      callerId: 'profile:profile-a',
      profileAuthority: { capabilities: ['sessions:discover'] },
    })
  })

  it('reaches no Session when the server scope is outside the profile', async () => {
    const client = await host.connect(
      host.serveOptions({
        workspaceRoots: [host.repos().repoB],
        identity: host.profileIdentity('repo-a-reviewer', ACTIVE_CREDENTIAL),
      }),
    )

    await expect(listedSessionIds(client)).resolves.toEqual([])
  })

  it.each([
    ['a revoked profile', 'revoked-reviewer', REVOKED_CREDENTIAL],
    ['an unknown profile', 'does-not-exist', ACTIVE_CREDENTIAL],
    ['a wrong credential', 'repo-a-reviewer', REVOKED_CREDENTIAL],
  ])('refuses %s at startup and on every call', async (_label, profile, credential) => {
    const options = host.serveOptions({ identity: host.profileIdentity(profile, credential) })
    await expect(verifyServeIdentity(options)).rejects.toThrow(
      `The Session Host refused the credential for access profile ${JSON.stringify(profile)}`,
    )
    const client = await host.connect(options)
    const result = await client.callTool({
      name: 'openwaggle_hive',
      arguments: { operation: 'list' },
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.structuredContent ?? {})).not.toContain('session-')
    expect(host.dispatchedCallers()).toEqual([])
  })

  it('still refuses a profile revoked after the server started', async () => {
    const options = host.serveOptions({
      identity: host.profileIdentity('repo-a-reviewer', ACTIVE_CREDENTIAL),
    })
    await verifyServeIdentity(options)
    const client = await host.connect(options)
    await expect(listedSessionIds(client)).resolves.toEqual(['session-a'])
    host.revoke('repo-a-reviewer')
    host.clearDispatchedCallers()

    const result = await client.callTool({
      name: 'openwaggle_hive',
      arguments: { operation: 'list' },
    })

    expect(result.isError).toBe(true)
    expect(host.dispatchedCallers()).toEqual([])
  })

  it('refuses an existing Session outside the profile, and names an unknown one (#351)', async () => {
    const client = await host.connect(
      host.serveOptions({
        grants: new Set(['sessions:read']),
        identity: host.profileIdentity('repo-a-reviewer', ACTIVE_CREDENTIAL),
      }),
    )
    const read = (sessionId: string) =>
      client.callTool({ name: 'openwaggle_hive', arguments: { operation: 'read', sessionId } })

    const inScope = await read('session-a')
    const outside = await read('session-b')
    const unknown = await read('session-unknown')

    expect(inScope.isError).not.toBe(true)
    expect(outside.isError).toBe(true)
    expect(JSON.stringify(outside.content)).toContain('target_scope_denied')
    expect(JSON.stringify(outside.content)).not.toContain(host.repos().repoB)
    expect(unknown.isError).toBe(true)
    expect(JSON.stringify(unknown.content)).toContain('session_not_found')
  })
})
