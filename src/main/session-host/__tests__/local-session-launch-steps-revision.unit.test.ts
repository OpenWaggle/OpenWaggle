import { describe, expect, it } from 'vitest'
import { negotiateLocalSessionProtocol } from '../local-session-negotiation'

describe('Local Session launch-steps revision', () => {
  it.each(['gui', 'cli', 'mcp', 'internal'] as const)(
    'rejects a revision-17 %s client that would reject labelled launch steps mid-stream',
    (clientKind) => {
      expect(
        negotiateLocalSessionProtocol(
          {
            protocol: 'openwaggle-local-session',
            supportedRevisions: [17],
            clientKind,
            clientVersion: 'previous',
          },
          'host-current',
        ),
      ).toEqual({
        accepted: false,
        protocol: 'openwaggle-local-session',
        code: 'incompatible_protocol',
        supportedRevisions: [19],
      })
    },
  )
})
