import { fromAny } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import type { executeLocalSessionCommand } from '../../session-host/local-session-client'
import { reconcileMcpOwnerRuntime } from '../mcp-owner-runtime-reconciliation'

const client = {
  paths: {
    stateRoot: '/state',
    legacyDatabasePath: '/state/legacy.sqlite',
    databasePath: '/state/host.sqlite',
    recoveryDatabasePath: '/state/recovery.sqlite',
    credentialPath: '/state/credential',
    endpoint: '/state/host.sock',
    endpointDirectory: '/state',
  },
  clientKind: 'cli' as const,
  clientVersion: 'test',
}

describe('MCP owner runtime reconciliation', () => {
  it('reacquires the Host after a broken pipe and safely retries the notification', async () => {
    const unavailable = Object.assign(new Error('broken pipe'), { code: 'EPIPE' })
    const execute = vi
      .fn()
      .mockRejectedValueOnce(unavailable)
      .mockImplementationOnce(async (input) => ({
        contract: 'host-ui-v1' as const,
        response: {
          contractVersion: 1 as const,
          requestId: input.payload.request.requestId,
          channel: 'mcp:get-settings' as const,
          result: { kind: 'undefined' as const },
        },
      }))
    const ensure = vi.fn(async () => undefined)

    await reconcileMcpOwnerRuntime(client, '/project', {
      execute: fromAny<typeof executeLocalSessionCommand, typeof execute>(execute),
      ensure,
    })

    expect(ensure).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[1]?.[0].payload.request.requestId).toBe(
      execute.mock.calls[0]?.[0].payload.request.requestId,
    )
  })

  it('does not retry a non-transport owner rejection', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('capability denied'))
    const ensure = vi.fn(async () => undefined)

    await expect(
      reconcileMcpOwnerRuntime(client, '/project', {
        execute: fromAny<typeof executeLocalSessionCommand, typeof execute>(execute),
        ensure,
      }),
    ).rejects.toThrow('capability denied')

    expect(execute).toHaveBeenCalledOnce()
    expect(ensure).not.toHaveBeenCalled()
  })
})
