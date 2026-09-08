import { describe, expect, it } from 'vitest'
import { decodeStoredSessionControlMutationOutcome } from '../sqlite-session-control-outcome-decoder'

describe.each([
  { operation: 'steer', effect: 'steered-run' },
  { operation: 'promote', effect: 'promoted-follow-up', followUpId: 'follow-up', queueRevision: 2 },
])('historical $operation receipt decoding', (fields) => {
  const outcome = { ...fields, sessionId: 'session', runId: 'run', stateRevision: 3 }

  it('retains old success with explicitly unavailable delivery correlation', () => {
    expect(decodeStoredSessionControlMutationOutcome(JSON.stringify(outcome))).toEqual({
      ...outcome,
      receipt: { delivery: 'unavailable' },
    })
  })

  it('does not use a historical text hash without an authoritative entry boundary', () => {
    expect(
      decodeStoredSessionControlMutationOutcome(
        JSON.stringify({
          ...outcome,
          receipt: { delivery: 'queued', durableTextSha256: 'b'.repeat(64) },
        }),
      ),
    ).toEqual({ ...outcome, receipt: { delivery: 'unavailable' } })
  })

  it.each([
    { delivery: 'queued', durableTextSha256: 'b'.repeat(64), minimumCreatedOrder: 17 },
    { delivery: 'handled' },
    { delivery: 'unavailable' },
  ])('preserves an existing $delivery receipt', (receipt) => {
    expect(
      decodeStoredSessionControlMutationOutcome(JSON.stringify({ ...outcome, receipt })),
    ).toEqual({ ...outcome, receipt })
  })

  it.each([null, { delivery: 'queued' }, { delivery: 'handled', durableText: 'leaked' }])(
    'does not treat a malformed current receipt as a historical success',
    (receipt) => {
      expect(() =>
        decodeStoredSessionControlMutationOutcome(JSON.stringify({ ...outcome, receipt })),
      ).toThrow()
    },
  )

  it('does not upgrade a historical outcome with missing required Run fields', () => {
    expect(() => decodeStoredSessionControlMutationOutcome(JSON.stringify(fields))).toThrow()
  })
})
