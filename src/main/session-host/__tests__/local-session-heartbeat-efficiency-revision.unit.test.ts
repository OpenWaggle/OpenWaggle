import { describe, expect, it } from 'vitest'
import {
  LOCAL_SESSION_CURRENT_REVISION,
  LOCAL_SESSION_HEARTBEAT_EFFICIENCY_REVISION,
} from '../../../shared/types/local-session-protocol-revisions'
import { negotiateLocalSessionProtocol } from '../local-session-negotiation'

const hello = {
  protocol: 'openwaggle-local-session' as const,
  clientKind: 'cli' as const,
  clientVersion: 'test',
}

describe('Local Session protocol revision 28 (Heartbeat efficiency, issue #388)', () => {
  it('refuses a revision-27 client, which decodes Scheduled tasks exactly without heartbeat', () => {
    expect(LOCAL_SESSION_HEARTBEAT_EFFICIENCY_REVISION).toBe(28)
    expect(LOCAL_SESSION_CURRENT_REVISION).toBe(LOCAL_SESSION_HEARTBEAT_EFFICIENCY_REVISION)
    expect(
      negotiateLocalSessionProtocol({ ...hello, supportedRevisions: [27] }, 'host'),
    ).toMatchObject({ accepted: false })
  })

  it('advertises the Heartbeat efficiency capability', () => {
    expect(
      negotiateLocalSessionProtocol({ ...hello, supportedRevisions: [28] }, 'host'),
    ).toMatchObject({
      accepted: true,
      revision: 28,
      capabilities: expect.arrayContaining([
        'scheduled-tasks:v1',
        'scheduled-tasks:heartbeat-efficiency-v1',
      ]),
    })
  })
})
