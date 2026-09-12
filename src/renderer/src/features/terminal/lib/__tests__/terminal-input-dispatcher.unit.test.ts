import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalInputIdentity } from '@shared/types/terminal'
import { describe, expect, it, vi } from 'vitest'
import {
  AWAITING_PROMPT,
  accepted,
  deferredWriteResult,
  READY,
  type TerminalInputWriter,
  testDispatcher,
} from './terminal-input-dispatcher-test-harness'

describe('terminal input dispatcher', () => {
  it('keeps a partially drained paste ordered across a viewport move', async () => {
    const firstWrite = deferredWriteResult()
    let firstIdentity: TerminalInputIdentity | null = null
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementationOnce((_ownerKey, _terminalId, _data, identity) => {
        firstIdentity = identity
        return firstWrite.promise
      })
      .mockImplementation(async (_ownerKey, _terminalId, data, identity) =>
        accepted(data, identity),
      )
    const dispatcher = testDispatcher(writer)
    const source = dispatcher.acquire('session-1', 'terminal-1')
    const input = 'x'.repeat(TERMINAL.MAX_INPUT_BYTES + 19)
    source.markOpen(READY)
    source.enqueue(input)

    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(1))
    source.release()
    const destination = dispatcher.acquire('session-1', 'terminal-1')
    destination.markOpen(READY)
    if (firstIdentity === null) throw new Error('Expected the first input identity')
    firstWrite.resolve(accepted('x'.repeat(TERMINAL.MAX_INPUT_BYTES), firstIdentity))

    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(2))
    expect(writer.mock.calls.map((call) => call[2]).join('')).toBe(input)
    expect(destination.generation).toBe(source.generation)
    expect(writer.mock.calls.map((call) => call[3].sequence)).toEqual([0, 1])
    expect(destination.snapshot().queuedChunks).toBe(0)
  })

  it('rekeys the same ordered and idempotent stream during draft owner migration', async () => {
    const firstWrite = deferredWriteResult()
    let firstIdentity: TerminalInputIdentity | null = null
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementationOnce((_ownerKey, _terminalId, _data, identity) => {
        firstIdentity = identity
        return firstWrite.promise
      })
      .mockImplementation(async (_ownerKey, _terminalId, data, identity) =>
        accepted(data, identity),
      )
    const dispatcher = testDispatcher(writer)
    const draft = dispatcher.acquire('draft:/repo', 'terminal-1')
    const input = 'y'.repeat(TERMINAL.MAX_INPUT_BYTES + 7)
    draft.markOpen(READY)
    draft.enqueue(input)

    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(1))
    dispatcher.migrateOwner('draft:/repo', 'session-1', ['terminal-1'])
    draft.release()
    const session = dispatcher.acquire('session-1', 'terminal-1')
    session.markOpen(READY)
    if (firstIdentity === null) throw new Error('Expected the first input identity')
    firstWrite.resolve(accepted('y'.repeat(TERMINAL.MAX_INPUT_BYTES), firstIdentity))

    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(2))
    expect(writer.mock.calls[0]?.[0]).toBe('draft:/repo')
    expect(writer.mock.calls[1]?.[0]).toBe('session-1')
    expect(writer.mock.calls.map((call) => call[2]).join('')).toBe(input)
    expect(session.generation).toBe('input-generation-1')
    expect(writer.mock.calls.map((call) => call[3].sequence)).toEqual([0, 1])
  })

  it('retains a rejected head and retries it with the same identity', async () => {
    const identities: TerminalInputIdentity[] = []
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementation(async (_owner, _id, data, id) => {
        identities.push(id)
        if (identities.length === 1) {
          return { status: 'rejected', acceptedBytes: 0, reason: 'queue-full', identity: id }
        }
        return accepted(data, id)
      })
    const dispatcher = testDispatcher(writer)
    const client = dispatcher.acquire('session-1', 'terminal-1')
    client.markOpen(AWAITING_PROMPT)
    client.enqueue('abc')

    await vi.waitFor(() => expect(client.snapshot().error).toContain('full'))
    expect(client.snapshot().queuedChunks).toBe(1)
    client.applyReleaseResult({ status: 'released', releasedBytes: 0 })

    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(2))
    expect(identities).toEqual([
      { generation: 'input-generation-1', sequence: 0 },
      { generation: 'input-generation-1', sequence: 0 },
    ])
    expect(client.snapshot()).toMatchObject({ error: null, queuedChunks: 0 })
  })

  it('does not let a late queued acknowledgement regress ready state', async () => {
    const deferred = deferredWriteResult()
    let identity: TerminalInputIdentity | null = null
    const writer = vi.fn<TerminalInputWriter>().mockImplementation((_owner, _id, _data, next) => {
      identity = next
      return deferred.promise
    })
    const client = testDispatcher(writer).acquire('session-1', 'terminal-1')
    client.markOpen(AWAITING_PROMPT)
    client.enqueue('abc')
    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce())

    client.markReady(READY)
    if (identity === null) throw new Error('Expected an input identity')
    deferred.resolve(accepted('abc', identity, 'queued'))

    await vi.waitFor(() => expect(client.snapshot().queuedChunks).toBe(0))
    expect(client.snapshot()).toMatchObject({ waiting: false, error: null })
  })

  it('atomically rejects UTF-8 input that would exceed the bounded runtime queue', async () => {
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementation(async (_owner, _id, data, id) => accepted(data, id))
    const client = testDispatcher(writer, 8).acquire('session-1', 'terminal-1')

    expect(client.enqueue('1234')).toEqual({ status: 'accepted' })
    expect(client.enqueue('🙂x')).toMatchObject({ status: 'rejected', reason: 'capacity' })
    expect(client.snapshot()).toMatchObject({ queuedChunks: 1, waiting: false })
    expect(client.snapshot().error).toContain('paste a smaller selection')

    client.markOpen(READY)
    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce())
    expect(writer.mock.calls[0]?.[2]).toBe('1234')
  })

  it('rejects input against bytes already retained by main', () => {
    const writer = vi.fn<TerminalInputWriter>()
    const client = testDispatcher(writer, 8).acquire('session-1', 'terminal-1')
    client.markOpen(AWAITING_PROMPT, 7)

    expect(client.enqueue('é')).toMatchObject({ status: 'rejected', reason: 'capacity' })
    expect(client.snapshot().waiting).toBe(true)
    expect(writer).not.toHaveBeenCalled()
  })

  it('keeps the sequence on an unverifiable acknowledgement until a valid replay arrives', async () => {
    const identities: TerminalInputIdentity[] = []
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementation(async (_owner, _id, data, id) => {
        identities.push(id)
        if (identities.length === 1) {
          return { status: 'written', acceptedBytes: 1, identity: id }
        }
        return accepted(data, id)
      })
    const client = testDispatcher(writer).acquire('session-1', 'terminal-1')
    client.markOpen(READY)
    client.enqueue('🙂')

    await vi.waitFor(() => expect(client.snapshot().error).toContain('could not be verified'))
    expect(client.snapshot().queuedChunks).toBe(1)
    client.retry()

    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(2))
    expect(identities.map((identity) => identity.sequence)).toEqual([0, 0])
    expect(client.snapshot()).toMatchObject({ queuedChunks: 0, error: null })
  })

  it('retains queued input across a transient unavailable view', async () => {
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementation(async (_owner, _id, data, id) => accepted(data, id))
    const dispatcher = testDispatcher(writer)
    const failedView = dispatcher.acquire('session-1', 'terminal-1')
    failedView.enqueue('typed-before-attach-failed')
    failedView.markUnavailable()
    failedView.release()

    const replacement = dispatcher.acquire('session-1', 'terminal-1')
    replacement.markOpen(READY)

    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce())
    expect(writer.mock.calls[0]?.[2]).toBe('typed-before-attach-failed')
    expect(replacement.generation).toBe('input-generation-1')
  })

  it('waits for the native attach identity before staging already queued input', async () => {
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementation(async (_owner, _id, data, id) => accepted(data, id, 'queued'))
    const client = testDispatcher(writer).acquire('session-1', 'terminal-1')
    client.enqueue('typed-during-open')

    expect(writer).not.toHaveBeenCalled()
    client.markOpening()
    client.markReady(READY)
    expect(writer).not.toHaveBeenCalled()
    client.markOpen(AWAITING_PROMPT, 0, 'native-record-1')

    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce())
    expect(writer.mock.calls[0]?.[2]).toBe('typed-during-open')
    expect(writer.mock.calls[0]?.[3].incarnation).toBe('native-record-1')
    expect(client.snapshot().queuedChunks).toBe(0)
  })
})
