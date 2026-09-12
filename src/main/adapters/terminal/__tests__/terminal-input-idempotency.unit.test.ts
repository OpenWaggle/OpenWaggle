import { describe, expect, it } from 'vitest'
import type { TerminalInputIdentityState } from '../terminal-input-idempotency'
import {
  activateTerminalInputGeneration,
  decideTerminalInputIdentity,
  receiptForTerminalInput,
} from '../terminal-input-idempotency'

function inputState(generation: string | null = null): TerminalInputIdentityState {
  return { inputGeneration: generation, lastInputReceipt: null }
}

describe('terminal input idempotency', () => {
  it('deduplicates an ambiguous retry without accepting different data', () => {
    const state = inputState('renderer-a')
    const identity = { generation: 'renderer-a', sequence: 0 }
    const accepted = { status: 'queued', acceptedBytes: 3, identity } as const
    state.lastInputReceipt = receiptForTerminalInput(identity, 'abc', accepted)

    expect(decideTerminalInputIdentity(state, 'abc', identity)).toEqual({
      kind: 'result',
      result: { status: 'queued', acceptedBytes: 3, identity },
    })
    expect(decideTerminalInputIdentity(state, 'xyz', identity)).toEqual({
      kind: 'result',
      result: { status: 'rejected', acceptedBytes: 0, reason: 'sequence-conflict', identity },
    })
  })

  it('requires an ambiguous retry to preserve its semantic input intent', () => {
    const state = inputState('renderer-a')
    const identity = { generation: 'renderer-a', sequence: 0 }
    const intent = { kind: 'project-action', executionId: 'execution-a' } as const
    const accepted = { status: 'queued', acceptedBytes: 4, identity } as const
    state.lastInputReceipt = receiptForTerminalInput(identity, 'run\r', accepted, intent)

    expect(decideTerminalInputIdentity(state, 'run\r', identity, intent)).toMatchObject({
      kind: 'result',
      result: { status: 'queued', acceptedBytes: 4 },
    })
    expect(decideTerminalInputIdentity(state, 'run\r', identity)).toMatchObject({
      result: { status: 'rejected', reason: 'sequence-conflict' },
    })
    expect(
      decideTerminalInputIdentity(state, 'run\r', identity, {
        kind: 'project-action',
        executionId: 'execution-b',
      }),
    ).toMatchObject({ result: { status: 'rejected', reason: 'sequence-conflict' } })
  })

  it('requires a contiguous sequence and rejects an older renderer generation', () => {
    const state = inputState('renderer-a')
    const first = { generation: 'renderer-a', sequence: 0 }
    state.lastInputReceipt = receiptForTerminalInput(first, 'a', {
      status: 'written',
      acceptedBytes: 1,
      identity: first,
    })

    const gap = { generation: 'renderer-a', sequence: 2 }
    expect(decideTerminalInputIdentity(state, 'c', gap)).toMatchObject({
      result: { status: 'rejected', reason: 'sequence-gap' },
    })
    const stale = { generation: 'renderer-old', sequence: 1 }
    expect(decideTerminalInputIdentity(state, 'b', stale)).toMatchObject({
      result: { status: 'rejected', reason: 'stale-generation' },
    })
  })

  it('activates a new renderer generation while preserving already queued input elsewhere', () => {
    const state = inputState('renderer-a')
    const identity = { generation: 'renderer-a', sequence: 0 }
    state.lastInputReceipt = receiptForTerminalInput(identity, 'queued', {
      status: 'queued',
      acceptedBytes: 6,
      identity,
    })

    activateTerminalInputGeneration(state, 'renderer-b')

    expect(state).toEqual({ inputGeneration: 'renderer-b', lastInputReceipt: null })
    expect(
      decideTerminalInputIdentity(state, 'next', { generation: 'renderer-b', sequence: 0 }),
    ).toEqual({ kind: 'accept' })
  })
})
