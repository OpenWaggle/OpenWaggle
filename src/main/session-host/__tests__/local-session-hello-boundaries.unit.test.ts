import { describe, expect, it } from 'vitest'
import { decodeLocalSessionClientHello } from '../../../shared/schemas/local-session-protocol'
import {
  LOCAL_SESSION_MAX_CLIENT_VERSION_LENGTH,
  LOCAL_SESSION_MAX_SUPPORTED_REVISIONS,
} from '../../../shared/types/local-session-protocol'

describe('Local Session hello boundaries', () => {
  it('bounds untrusted revision lists and client versions', () => {
    const base = {
      protocol: 'openwaggle-local-session',
      clientKind: 'cli',
    } as const
    expect(() =>
      decodeLocalSessionClientHello({
        ...base,
        supportedRevisions: Array.from(
          { length: LOCAL_SESSION_MAX_SUPPORTED_REVISIONS },
          (_, index) => index + 1,
        ),
        clientVersion: 'v'.repeat(LOCAL_SESSION_MAX_CLIENT_VERSION_LENGTH),
      }),
    ).not.toThrow()
    expect(() =>
      decodeLocalSessionClientHello({
        ...base,
        supportedRevisions: Array.from(
          { length: LOCAL_SESSION_MAX_SUPPORTED_REVISIONS + 1 },
          (_, index) => index + 1,
        ),
        clientVersion: 'current',
      }),
    ).toThrow()
    expect(() =>
      decodeLocalSessionClientHello({
        ...base,
        supportedRevisions: [2],
        clientVersion: 'v'.repeat(LOCAL_SESSION_MAX_CLIENT_VERSION_LENGTH + 1),
      }),
    ).toThrow()
    expect(() =>
      decodeLocalSessionClientHello({
        ...base,
        supportedRevisions: [2],
        clientVersion: 'current',
        profile: ' worker ',
      }),
    ).toThrow()
  })
})
