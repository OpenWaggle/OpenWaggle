import { describe, expect, it } from 'vitest'
import { decodeHostUiV1Request, decodeHostUiV1Result } from '../host-ui-protocol'

describe('Host UI protocol', () => {
  it('accepts only explicitly host-backed GUI channels', () => {
    expect(
      decodeHostUiV1Request({
        contractVersion: 1,
        requestId: 'request-list',
        channel: 'sessions:list-details',
        args: [20],
      }),
    ).toMatchObject({ channel: 'sessions:list-details', args: [20] })

    expect(() =>
      decodeHostUiV1Request({
        contractVersion: 1,
        requestId: 'request-shell',
        channel: 'shell:open-path',
        args: ['/tmp'],
      }),
    ).toThrow()
  })

  it('validates response envelopes exactly', () => {
    expect(
      decodeHostUiV1Result({
        contractVersion: 1,
        requestId: 'request-list',
        channel: 'sessions:list-details',
        result: [],
      }),
    ).toMatchObject({ channel: 'sessions:list-details', result: [] })

    expect(() =>
      decodeHostUiV1Result({
        contractVersion: 1,
        requestId: 'request-list',
        channel: 'sessions:list-details',
        result: [],
        undeclared: true,
      }),
    ).toThrow()
    expect(() =>
      decodeHostUiV1Result({
        contractVersion: 1,
        requestId: 'request-list',
        channel: 'shell:open-path',
        result: undefined,
      }),
    ).toThrow()
  })
})
