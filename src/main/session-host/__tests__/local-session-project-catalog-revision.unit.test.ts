import {
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
} from '@shared/schemas/local-session-protocol'
import { describe, expect, it } from 'vitest'
import { supportedRevisionsForCommand } from '../local-session-client'

describe('Local Session project catalog revision', () => {
  it('requires a revision-twelve Host for indexed Settings project discovery', () => {
    const payload = decodeLocalSessionCommandPayload({
      contract: 'host-ui-v1',
      request: {
        contractVersion: 1,
        requestId: 'project-catalog',
        channel: 'sessions:list-projects',
        args: [{ kind: 'value', value: 100 }],
      },
    })

    expect(supportedRevisionsForCommand(payload)).toEqual([17])
    expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 11)).toThrow(/revision 12/)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 12)).toEqual(payload)
  })

  it('requires revision thirteen for per-file Turn diffs', () => {
    const payload = decodeLocalSessionCommandPayload({
      contract: 'host-ui-v1',
      request: {
        contractVersion: 1,
        requestId: 'turn-diff-files',
        channel: 'sessions:turn-diff-files:get',
        args: [
          { kind: 'value', value: 'session-1' },
          { kind: 'value', value: 'turn-1' },
        ],
      },
    })

    expect(supportedRevisionsForCommand(payload)).toEqual([17])
    expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 12)).toThrow(/revision 13/)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 13)).toEqual(payload)
  })

  it('requires revision sixteen for Host-owned Session resources', () => {
    const payload = decodeLocalSessionCommandPayload({
      contract: 'host-ui-v1',
      request: {
        contractVersion: 1,
        requestId: 'session-resources',
        channel: 'sessions:resources:page',
        args: [
          { kind: 'value', value: 'session-1' },
          { kind: 'value', value: { view: 'all', limit: 50 } },
        ],
      },
    })

    expect(supportedRevisionsForCommand(payload)).toEqual([17])
    expect(() => decodeLocalSessionCommandPayloadForRevision(payload, 15)).toThrow(/revision 16/)
    expect(decodeLocalSessionCommandPayloadForRevision(payload, 16)).toEqual(payload)
  })
})
