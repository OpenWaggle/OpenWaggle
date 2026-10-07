import {
  LOCAL_SESSION_REVISION_20_CAPABILITIES,
  type LocalSessionCommandPayload,
} from '@shared/types/local-session-protocol'
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

// The thinking level is the fourth argument, which revision 21 added.
const CREATE_AT_LEVEL: LocalSessionCommandPayload = {
  contract: 'host-ui-v1',
  request: {
    contractVersion: 1,
    requestId: 'request-create',
    channel: 'sessions:create',
    args: [
      { kind: 'value', value: '/project' },
      { kind: 'undefined' },
      { kind: 'undefined' },
      { kind: 'value', value: 'high' },
    ],
  },
}

describe('creating a Session at a thinking level', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is never sent to a Host that negotiated revision 20', async () => {
    const destroy = vi.fn()
    const next = vi.fn()
    vi.mocked(openLocalSessionConnection).mockResolvedValue(
      fromPartial({
        socket: { destroy },
        reader: { next },
        negotiation: fromAny({
          accepted: true,
          protocol: 'openwaggle-local-session',
          revision: 20,
          hostInstanceId: 'old-host',
          capabilities: LOCAL_SESSION_REVISION_20_CAPABILITIES,
        }),
      }),
    )

    await expect(
      executeLocalSessionCommand({
        paths: resolveLocalSessionHostPaths({ userDataRoot: '/test-profile' }),
        payload: CREATE_AT_LEVEL,
        clientKind: 'gui',
        clientVersion: 'test',
        supportedRevisions: [20],
      }),
    ).rejects.toThrow(
      'The connected Session Host does not support creating a Session at a thinking level.',
    )

    expect(writeLocalSessionFrame).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('offers the Host only revision 21 or later for it', async () => {
    vi.mocked(openLocalSessionConnection).mockRejectedValue(new Error('stop after negotiation'))

    await expect(
      executeLocalSessionCommand({
        paths: resolveLocalSessionHostPaths({ userDataRoot: '/test-profile' }),
        payload: CREATE_AT_LEVEL,
        clientKind: 'gui',
        clientVersion: 'test',
      }),
    ).rejects.toThrow('stop after negotiation')

    expect(openLocalSessionConnection).toHaveBeenCalledWith(
      expect.objectContaining({ supportedRevisions: [22] }),
    )
  })
})
