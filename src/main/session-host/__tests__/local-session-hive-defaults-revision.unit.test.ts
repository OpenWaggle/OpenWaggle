import { describe, expect, it } from 'vitest'
import {
  LOCAL_SESSION_CURRENT_REVISION,
  LOCAL_SESSION_HIVE_DEFAULTS_REVISION,
} from '../../../shared/types/local-session-protocol-revisions'
import { negotiateLocalSessionProtocol } from '../local-session-negotiation'

const hello = {
  protocol: 'openwaggle-local-session' as const,
  clientKind: 'cli' as const,
  clientVersion: 'test',
}

describe('Local Session protocol revision 27 (Hive defaults, issue #352)', () => {
  it('refuses a revision-26 client, which decodes queue outcomes with followUpIds exactly', () => {
    expect(LOCAL_SESSION_HIVE_DEFAULTS_REVISION).toBe(27)
    expect(LOCAL_SESSION_CURRENT_REVISION).toBeGreaterThanOrEqual(
      LOCAL_SESSION_HIVE_DEFAULTS_REVISION,
    )
    expect(
      negotiateLocalSessionProtocol({ ...hello, supportedRevisions: [26] }, 'host'),
    ).toMatchObject({ accepted: false })
  })

  it('advertises the Hive defaults capability', () => {
    expect(
      negotiateLocalSessionProtocol(
        { ...hello, supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION] },
        'host',
      ),
    ).toMatchObject({
      accepted: true,
      revision: LOCAL_SESSION_CURRENT_REVISION,
      capabilities: expect.arrayContaining(['sessions:hive-defaults-v1']),
    })
  })
})
