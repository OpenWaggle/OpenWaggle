import { describe, expect, it } from 'vitest'
import { decodeLocalSessionCommandResponse } from '../local-session-client-response'

describe('Local Session client Host UI response decoding', () => {
  it('rejects Host-only attachment snapshot bytes in a client response', () => {
    expect(() =>
      decodeLocalSessionCommandResponse(
        {
          kind: 'response',
          requestId: 'wire-request',
          payload: {
            contract: 'local-attachments-v1',
            response: {
              requestId: 'prepare-request',
              attachments: [
                {
                  id: 'attachment-1',
                  kind: 'text',
                  name: 'notes.txt',
                  path: '/tmp/notes.txt',
                  mimeType: 'text/plain',
                  sizeBytes: 5,
                  extractedText: 'notes',
                  immutableSourceBase64: 'bm90ZXM=',
                },
              ],
            },
          },
        },
        'wire-request',
      ),
    ).toThrow()
  })

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

  it('preserves a Host protocol error code for machine-facing classification', () => {
    expect(() =>
      decodeLocalSessionCommandResponse(
        {
          kind: 'error',
          requestId: 'wire-request',
          code: 'authentication_failed',
          message: '',
          retryable: false,
        },
        'wire-request',
      ),
    ).toThrow(
      expect.objectContaining({
        name: 'LocalSessionClientProtocolError',
        code: 'authentication_failed',
        message: 'Local Session command failed.',
        retryable: false,
      }),
    )
  })
})
