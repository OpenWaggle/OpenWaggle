import { describe, expect, it } from 'vitest'
import { decodeLocalSessionCommandResponse } from '../local-session-client-response'

describe('Local Session client Host UI response decoding', () => {
  it('decodes an exact Host UI response', () => {
    expect(
      decodeLocalSessionCommandResponse(
        {
          kind: 'response',
          requestId: 'wire-request',
          payload: {
            contract: 'host-ui-v1',
            response: {
              contractVersion: 1,
              requestId: 'host-ui-request',
              channel: 'settings:get',
              result: { kind: 'value', value: { theme: 'system' } },
            },
          },
        },
        'wire-request',
      ),
    ).toMatchObject({ contract: 'host-ui-v1', response: { channel: 'settings:get' } })
  })

  it('rejects an invalid Host UI response before exposing it to the client', () => {
    expect(() =>
      decodeLocalSessionCommandResponse(
        {
          kind: 'response',
          requestId: 'wire-request',
          payload: {
            contract: 'host-ui-v1',
            response: {
              contractVersion: 1,
              requestId: 'host-ui-request',
              channel: 'shell:open-path',
              result: { kind: 'undefined' },
            },
          },
        },
        'wire-request',
      ),
    ).toThrow()
  })
})
