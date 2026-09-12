import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { LOCAL_SESSION_REVISION_9_CAPABILITIES } from '@shared/types/local-session-protocol'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeLocalSessionCommand } from '../local-session-client'
import {
  openLocalSessionConnection,
  writeLocalSessionFrame,
} from '../local-session-client-connection'
import { resolveLocalSessionHostPaths } from '../local-session-paths'

vi.mock('../local-session-client-connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../local-session-client-connection')>()),
  openLocalSessionConnection: vi.fn(),
  writeLocalSessionFrame: vi.fn(),
}))

describe('Local Session grant client fail-closed boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['authorization-grants:grant', 'authorization-grants:revoke'] as const)(
    'does not send %s when an explicit override negotiates revision nine',
    async (channel) => {
      const destroy = vi.fn()
      const next = vi.fn()
      vi.mocked(openLocalSessionConnection).mockResolvedValue(
        fromPartial({
          socket: { destroy },
          reader: { next },
          negotiation: fromAny({
            accepted: true,
            protocol: 'openwaggle-local-session',
            revision: 9,
            hostInstanceId: 'old-host',
            capabilities: LOCAL_SESSION_REVISION_9_CAPABILITIES,
          }),
        }),
      )
      const payload: LocalSessionCommandPayload = {
        contract: 'host-ui-v1',
        request: {
          contractVersion: 1,
          requestId: 'request-grant',
          channel,
          args: [
            { kind: 'value', value: '/project' },
            {
              kind: 'value',
              value: { requester: 'MCP', requesterId: 'server', capability: 'mcp.tool-call' },
            },
          ],
        },
      }

      await expect(
        executeLocalSessionCommand({
          paths: resolveLocalSessionHostPaths({ userDataRoot: '/test-profile' }),
          payload,
          clientKind: 'gui',
          clientVersion: 'test',
          supportedRevisions: [9],
        }),
      ).rejects.toThrow('The connected Session Host does not support Host UI requests.')

      expect(writeLocalSessionFrame).not.toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
      expect(destroy).toHaveBeenCalledOnce()
    },
  )
})
