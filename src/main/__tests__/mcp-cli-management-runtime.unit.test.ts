import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { describe, expect, it, vi } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  reconcile: vi.fn(),
}))

vi.mock('../local-session-cli-client', () => ({
  createLocalSessionCliClientInput: mocks.createClient,
}))

vi.mock('../application/mcp-owner-runtime-reconciliation', () => ({
  reconcileMcpOwnerRuntime: mocks.reconcile,
}))

import { reconcileOwningMcpHost } from '../mcp-cli-management-runtime'

describe('MCP CLI owner runtime preflight', () => {
  it('requires the current Session Host revision before reconciliation', async () => {
    const client = { clientKind: 'cli', clientVersion: 'test' }
    mocks.createClient.mockResolvedValueOnce(client)
    mocks.reconcile.mockResolvedValueOnce(undefined)
    const args = parseMcpCliArguments(['--project', '/project'])

    await reconcileOwningMcpHost(args, '/project')

    expect(mocks.createClient).toHaveBeenCalledWith(args, {
      supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
    })
    expect(mocks.reconcile).toHaveBeenCalledWith(client, '/project')
  })
})
