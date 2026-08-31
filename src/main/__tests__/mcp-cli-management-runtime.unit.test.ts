import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { describe, expect, it, vi } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  executeHostUi: vi.fn(),
}))

vi.mock('../local-session-cli-client', () => ({
  createLocalSessionCliClientInput: mocks.createClient,
}))

vi.mock('../application/configured-host-ui-client', () => ({
  executeHostUi: mocks.executeHostUi,
}))

import { createMcpCliManagementRuntime } from '../mcp-cli-management-runtime'

describe('MCP CLI owner runtime', () => {
  it('executes mutations in the current-revision Session Host owner', async () => {
    const client = { clientKind: 'cli', clientVersion: 'test' }
    mocks.createClient.mockResolvedValueOnce(client)
    mocks.executeHostUi.mockResolvedValueOnce({ servers: [] })
    const args = parseMcpCliArguments(['--project', '/project'])

    const runtime = await createMcpCliManagementRuntime(args)
    await runtime.service.removeServer({ projectPath: '/project', instanceId: 'server-1' })

    expect(mocks.createClient).toHaveBeenCalledWith(args, {
      supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
    })
    expect(mocks.executeHostUi).toHaveBeenCalledWith({
      client,
      channel: 'mcp:remove-server',
      args: [{ projectPath: '/project', instanceId: 'server-1' }],
    })
  })
})
