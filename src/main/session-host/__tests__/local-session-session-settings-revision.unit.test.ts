import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
} from '@shared/schemas/local-session-protocol'
import { describe, expect, it } from 'vitest'
import { supportedRevisionsForCommand } from '../local-session-client'

function hostUiCommand(
  channel:
    | 'sessions:regenerate-title'
    | 'sessions:set-thinking-level'
    | 'sessions:get-default-thinking-level'
    | 'sessions:set-default-thinking-level',
) {
  return decodeLocalSessionCommandPayload({
    contract: 'host-ui-v1',
    request: { contractVersion: 1, requestId: `request-${channel}`, channel, args: [] },
  })
}

describe('Session settings and Title regeneration protocol revisions', () => {
  it('keeps Title regeneration at revision 20', () => {
    const payload = hostUiCommand('sessions:regenerate-title')
    expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 19)).toThrow(/revision 20/)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 20)).toEqual(payload)
  })

  it.each([
    'sessions:set-thinking-level',
    'sessions:get-default-thinking-level',
    'sessions:set-default-thinking-level',
  ] as const)('requires a revision-21 Host for %s', (channel) => {
    const payload = hostUiCommand(channel)
    expect(supportedRevisionsForCommand(payload)).toEqual([21])
    expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 20)).toThrow(/revision 21/)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 21)).toEqual(payload)
  })

  it('requires a revision-21 Host to adopt a Follow-up', () => {
    const payload = decodeLocalSessionCommandPayload({
      contract: 'session-control-v2',
      request: {
        contractVersion: 2,
        requestId: 'r',
        idempotencyKey: 'k',
        command: {
          operation: 'queue-adopt',
          sessionId: 'session-1',
          followUpId: 'follow-up-1',
          expectedQueueRevision: 3,
        },
      },
    })
    // The client offers only the revisions the Host requires, so an older Host is refused before
    // the command is sent instead of failing to decode it.
    expect(supportedRevisionsForCommand(payload)).toEqual([21])
    expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 20)).toThrow(/revision 21/)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 21)).toEqual(payload)
  })

  function createCommand(args: readonly unknown[]) {
    return decodeLocalSessionCommandPayload({
      contract: 'host-ui-v1',
      request: {
        contractVersion: 1,
        requestId: 'request-create',
        channel: 'sessions:create',
        args: args.map((value) =>
          value === undefined ? { kind: 'undefined' } : { kind: 'value', value },
        ),
      },
    })
  }

  it('requires a revision-21 Host to create a Session at a thinking level', () => {
    const payload = createCommand(['/repo', undefined, undefined, 'high'])
    expect(supportedRevisionsForCommand(payload)).toEqual([21])
    expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 20)).toThrow(/revision 21/)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 21)).toEqual(payload)
  })

  it.each([
    [['/repo']],
    [['/repo', { environmentMode: 'local', baseRef: null, startFromOrigin: false }]],
    [['/repo', undefined, 'openai/gpt-5.5']],
  ])('still sends a create without a thinking level to a revision-20 Host (%j)', (args) => {
    const payload = createCommand(args)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 20)).toEqual(payload)
  })
})
