import type { TerminalInputIdentity, TerminalWriteResult } from '@shared/types/terminal'
import { describe, expect, it, vi } from 'vitest'
import { createTerminalInputDispatcher } from '../terminal-input-dispatcher'

const READY = { phase: 'ready', generation: 1 } as const

type TerminalInputWriter = (
  ownerKey: string,
  terminalId: string,
  data: string,
  identity: TerminalInputIdentity,
) => Promise<TerminalWriteResult>

function accepted(data: string, identity: TerminalInputIdentity): TerminalWriteResult {
  return { status: 'written', acceptedBytes: new TextEncoder().encode(data).byteLength, identity }
}

function testDispatcher(writer: TerminalInputWriter) {
  let generation = 0
  return createTerminalInputDispatcher(writer, {
    createGeneration: () => {
      generation += 1
      return `input-generation-${generation}`
    },
  })
}

describe('terminal input dispatcher lifecycle', () => {
  it('drains and compacts many queued entries without changing order', async () => {
    let resolveFirst: (result: TerminalWriteResult) => void = () => undefined
    const firstWrite = new Promise<TerminalWriteResult>((resolve) => {
      resolveFirst = resolve
    })
    let firstIdentity: TerminalInputIdentity | null = null
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementationOnce((_owner, _id, _data, identity) => {
        firstIdentity = identity
        return firstWrite
      })
      .mockImplementation(async (_owner, _id, data, identity) => accepted(data, identity))
    const client = testDispatcher(writer).acquire('session-1', 'terminal-1')
    client.markOpen(READY)
    const inputs = Array.from({ length: 130 }, (_, index) => `${index},`)
    for (const input of inputs) client.enqueue(input)
    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce())

    if (firstIdentity === null) throw new Error('Expected the first input identity')
    resolveFirst(accepted(inputs[0] ?? '', firstIdentity))

    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(inputs.length))
    expect(writer.mock.calls.map((call) => call[2])).toEqual(inputs)
    expect(client.snapshot().queuedChunks).toBe(0)
  })

  it('tombstones stale clients when their session owner is deleted', () => {
    const writer = vi.fn<TerminalInputWriter>()
    const dispatcher = testDispatcher(writer)
    const deleted = dispatcher.acquire('session-1', 'terminal-1')
    const survivor = dispatcher.acquire('session-2', 'terminal-2')
    deleted.enqueue('discard me')
    survivor.enqueue('keep me')

    dispatcher.clearOwner('session-1')

    expect(deleted.snapshot()).toMatchObject({ queuedChunks: 0, waiting: false, error: null })
    expect(survivor.snapshot()).toMatchObject({ queuedChunks: 1 })
    expect(deleted.enqueue('stale input')).toMatchObject({ status: 'rejected', reason: 'inactive' })
    deleted.markOpen(READY)
    expect(writer).not.toHaveBeenCalled()
  })

  it('preflights owner migration collisions without mutating either stream', async () => {
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementation(async (_owner, _id, data, identity) => accepted(data, identity))
    const dispatcher = testDispatcher(writer)
    const source = dispatcher.acquire('draft:/repo', 'terminal-1')
    const destination = dispatcher.acquire('session-1', 'terminal-1')
    source.enqueue('draft input')
    destination.enqueue('session input')

    expect(() =>
      dispatcher.assertOwnerMigrationAvailable('draft:/repo', 'session-1', ['terminal-1']),
    ).toThrow('Terminal input state already exists')
    expect(() => dispatcher.migrateOwner('draft:/repo', 'session-1', ['terminal-1'])).toThrow(
      'Terminal input state already exists',
    )

    source.markOpen(READY)
    destination.markOpen(READY)
    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(2))
    expect(writer.mock.calls.map((call) => [call[0], call[2]])).toEqual([
      ['draft:/repo', 'draft input'],
      ['session-1', 'session input'],
    ])
  })
})
