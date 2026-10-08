import { describe, expect, it, vi } from 'vitest'
import type { McpPoolServerConnection } from '../../../mcp/pool/mcp-session-connection-pool-types'
import { closeTurnedOffMcpServers } from '../mcp-turned-off-servers'

function connection(
  sessionId: string,
  name: string,
  projectPath: string | null,
): McpPoolServerConnection {
  return { sessionId, name, identity: `id-${name}`, projectPath }
}

describe('closing MCP servers a configuration change turned off', () => {
  it('closes the connections of servers turned off or removed in their own project only', async () => {
    const closeServer = vi.fn(async () => undefined)
    const pool = {
      closeServer,
      serverConnections: () => [
        connection('a', 'docs', '/p1'),
        connection('a', 'lint', '/p1'),
        connection('b', 'docs', '/p2'),
        connection('c', 'gone', null),
      ],
    }
    const enabled: Record<string, Record<string, boolean>> = {
      '/p1': { docs: false, lint: true },
      '/p2': { docs: true },
      '': {},
    }

    await closeTurnedOffMcpServers(pool, (projectPath) =>
      Object.entries(enabled[projectPath ?? ''] ?? {}).map(([name, on]) => ({
        name,
        enabled: on,
      })),
    )

    expect(closeServer.mock.calls).toEqual([
      ['a', 'docs'],
      ['c', 'gone'],
    ])
  })

  it('closes nothing of a project whose files cannot be read', async () => {
    const closeServer = vi.fn(async () => undefined)
    const pool = { closeServer, serverConnections: () => [connection('a', 'docs', '/p1')] }

    await closeTurnedOffMcpServers(pool, () => undefined)

    expect(closeServer).not.toHaveBeenCalled()
  })
})
