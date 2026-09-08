import { describe, expect, it } from 'vitest'
import { decodeSessionControlMutationOutcome } from '../session-control'

describe.each([
  {
    operation: 'steer',
    effect: 'steered-run',
    sessionId: 'session',
    runId: 'run',
    stateRevision: 1,
  },
  {
    operation: 'promote',
    effect: 'promoted-follow-up',
    sessionId: 'session',
    runId: 'run',
    stateRevision: 1,
    followUpId: 'follow-up',
    queueRevision: 1,
  },
])('$operation receipt boundary', (outcome) => {
  it('requires an explicit receipt at the current wire boundary', () => {
    expect(() => decodeSessionControlMutationOutcome(outcome)).toThrow()
  })

  it.each([
    { delivery: 'queued', durableTextSha256: '0123456789abcdef'.repeat(4), minimumCreatedOrder: 0 },
    { delivery: 'handled' },
    { delivery: 'unavailable' },
  ])('accepts a $delivery receipt', (receipt) => {
    expect(decodeSessionControlMutationOutcome({ ...outcome, receipt })).toEqual({
      ...outcome,
      receipt,
    })
  })

  it.each([
    { delivery: 'queued' },
    { delivery: 'queued', durableTextSha256: 'a'.repeat(64) },
    { delivery: 'queued', durableTextSha256: 'a'.repeat(64), minimumCreatedOrder: -1 },
    { delivery: 'queued', durableTextSha256: 'a'.repeat(64), minimumCreatedOrder: 0.5 },
    { delivery: 'queued', durableTextSha256: 'short', minimumCreatedOrder: 0 },
    { delivery: 'queued', durableTextSha256: 'A'.repeat(64), minimumCreatedOrder: 0 },
    {
      delivery: 'queued',
      durableTextSha256: 'a'.repeat(64),
      minimumCreatedOrder: 0,
      durableText: 'private attachment content',
    },
    { delivery: 'handled', durableText: 'private attachment content' },
  ])('rejects missing/invalid hashes and raw durable text: %j', (receipt) => {
    expect(() => decodeSessionControlMutationOutcome({ ...outcome, receipt })).toThrow()
  })
})
