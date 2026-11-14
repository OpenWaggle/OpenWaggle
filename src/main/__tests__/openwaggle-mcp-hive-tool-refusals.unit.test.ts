import os from 'node:os'
import path from 'node:path'
import type { SessionCapability } from '@shared/types/session-capability'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import type { OpenWaggleMcpServer } from '../openwaggle-mcp-server-policy'
import { LocalSessionClientProtocolError } from '../session-host/local-session-client-protocol-error'

vi.mock('../session-host/local-session-paths', () => ({
  prepareLocalSessionHostPaths: vi.fn(async () => ({})),
  refreshLocalSessionHostEndpoint: vi.fn(async () => ({})),
  resolveLocalSessionHostPaths: vi.fn(() => ({})),
}))

import { registerOpenWaggleSessionToolV2 } from '../openwaggle-mcp-session-tool-v2'

function hiveTool(grants: readonly SessionCapability[], execute: () => Promise<never>) {
  const registerTool = vi.fn()
  registerOpenWaggleSessionToolV2(
    fromPartial<OpenWaggleMcpServer>({ registerTool }),
    {
      transport: 'stdio',
      grants: new Set(grants),
      workspaceRoots: [],
      sessionIds: new Set(),
      identity: { kind: 'owner', label: 'test', authorizationCeiling: 'ask-for-approval' },
      userDataRoot: '/user-data',
      version: 'test',
    },
    { userDataRoot: '/user-data', version: 'test', execute },
  )
  const handler: unknown = registerTool.mock.calls[0]?.[2]
  if (typeof handler !== 'function') throw new Error('No tool handler was registered.')
  return (input: object) => handler(input)
}

/** Every openwaggle_hive refusal starts with its code and kind (ADR 0063). */
describe('openwaggle_hive refusals', () => {
  it('names the kind of a refusal the Session Host throws at the scope check', async () => {
    const execute = vi.fn<() => Promise<never>>(async () => {
      throw new LocalSessionClientProtocolError(
        'capability_denied',
        'Session command refused (capability_denied): no read.',
        { errorKind: 'authorization' },
      )
    })

    await expect(
      hiveTool(['sessions:read'], execute)({ operation: 'status', sessionId: 'session-1' }),
    ).rejects.toThrow(
      'capability_denied (authorization): Session command refused (capability_denied): no read.',
    )
    expect(execute).toHaveBeenCalledOnce()
  })

  it('names the kind of its own grant check', async () => {
    const execute = vi.fn<() => Promise<never>>(async () => {
      throw new Error('The Session Host must not be asked.')
    })

    await expect(
      hiveTool([], execute)({ operation: 'status', sessionId: 'session-1' }),
    ).rejects.toThrow(
      'capability_denied (authorization): This MCP server was started without --grant',
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('names the kind of its workspace check for Agent-definition discovery', async () => {
    const execute = vi.fn<() => Promise<never>>(async () => {
      throw new Error('The Session Host must not be asked.')
    })

    await expect(hiveTool([], execute)({ operation: 'agent-definitions-list' })).rejects.toThrow(
      'target_scope_denied (authorization): Agent-definition discovery requires an explicit MCP workspace grant.',
    )
  })

  it('names the kind of its export-root check', async () => {
    const execute = vi.fn<() => Promise<never>>(async () => {
      throw new Error('The Session Host must not be asked.')
    })

    await expect(
      hiveTool(
        ['sessions:read', 'sessions:export'],
        execute,
      )({
        operation: 'export-create',
        sessionId: 'session-1',
        destinationPath: path.join(os.tmpdir(), 'export.jsonl'),
      }),
    ).rejects.toThrow(
      'target_scope_denied (authorization): The export destination is outside the granted filesystem scope.',
    )
    expect(execute).not.toHaveBeenCalled()
  })
})
