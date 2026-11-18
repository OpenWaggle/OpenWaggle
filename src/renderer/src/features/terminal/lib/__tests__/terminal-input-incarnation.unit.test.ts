import { describe, expect, it, vi } from 'vitest'
import {
  accepted,
  deferredText,
  deferredWriteResult,
  READY,
  type TerminalInputWriter,
  testDispatcher,
} from './terminal-input-dispatcher-test-harness'

function acceptingWriter() {
  return vi
    .fn<TerminalInputWriter>()
    .mockImplementation(async (_owner, _id, data, identity) => accepted(data, identity))
}

describe('terminal input native incarnation handshake', () => {
  it('retires old clipboard reads and queued actions without disabling mounted input', async () => {
    const writer = acceptingWriter()
    const client = testDispatcher(writer, undefined, 1).acquire('session', 'terminal')
    client.markOpen({ phase: 'ready', generation: 9 }, 0, 'old-record')
    const clipboard = deferredText()
    const pendingPaste = client.enqueueAsync(() => clipboard.promise)
    await Promise.resolve()
    const action = client.enqueueProjectAction('old action\r', 'action-1')
    client.markOpening()
    client.markOpen(READY, 0, 'replacement-record')
    expect(await action).toMatchObject({ status: 'rejected', reason: 'inactive' })
    expect(client.enqueue('must not become a command suffix')).toMatchObject({ status: 'rejected' })
    client.markOpening()
    client.markOpen(READY, 0, 'replacement-record')
    expect(await client.enqueueAsync(async () => 'fresh paste')).toEqual({ status: 'accepted' })
    clipboard.resolve('old paste')
    expect(await pendingPaste).toMatchObject({ status: 'rejected', reason: 'inactive' })
    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce())
    expect(writer.mock.calls[0]?.[2]).toBe('fresh paste')
    expect(writer.mock.calls[0]?.[3]).toMatchObject({
      sequence: 0,
      incarnation: 'replacement-record',
    })
    expect(client.snapshot()).toMatchObject({ error: null, queuedChunks: 0 })
  })

  it('keeps sequence, queued actions and clipboard reads for same-record reattach and Restart', async () => {
    const writer = acceptingWriter()
    const dispatcher = testDispatcher(writer)
    const first = dispatcher.acquire('session', 'terminal')
    first.markOpen(READY, 0, 'same-record')
    first.enqueue('first')
    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce())
    const clipboard = deferredText()
    const paste = first.enqueueAsync(() => clipboard.promise)
    const action = first.enqueueProjectAction('action\r', 'action-1')
    first.release()
    const current = dispatcher.acquire('session', 'terminal')
    current.markOpening()
    current.markOpen({ phase: 'ready', generation: 2 }, 0, 'same-record')
    clipboard.resolve('paste')
    expect(await paste).toEqual({ status: 'accepted' })
    expect(await action).toEqual({ status: 'accepted' })
    expect(writer.mock.calls.map((call) => [call[2], call[3].sequence])).toEqual([
      ['first', 0],
      ['paste', 1],
      ['action\r', 2],
    ])
  })

  it('does not let early readiness, release or retry bypass a missing attach identity', async () => {
    const writer = acceptingWriter()
    const client = testDispatcher(writer).acquire('session', 'terminal')
    client.markOpening()
    client.enqueue('queued')
    client.markReady(READY)
    client.markOpen(READY)
    expect(client.snapshot().error).toContain('identity could not be verified')
    client.applyReleaseResult({ status: 'released', releasedBytes: 0 })
    client.retry()
    expect(writer).not.toHaveBeenCalled()
    client.markOpen(READY, 0, 'proven-record')
    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce())
  })

  it('blocks a command suffix after retiring keys typed during replacement attach until explicit reopen', async () => {
    const writer = acceptingWriter()
    const client = testDispatcher(writer).acquire('session', 'terminal')
    client.markOpen(READY, 0, 'old-record')
    client.markOpening()
    client.enqueue('echo ')
    client.markOpen(READY, 0, 'replacement-record')
    expect(writer).not.toHaveBeenCalled()
    expect(client.snapshot().error).toBe(
      'The previous terminal stopped. Queued input was not sent. Reopen or restart the terminal before typing again.',
    )
    expect(client.enqueue('dangerous-command\r')).toMatchObject({ status: 'rejected' })
    client.markReady(READY)
    client.applyReleaseResult({ status: 'released', releasedBytes: 0 })
    client.retry()
    expect(writer).not.toHaveBeenCalled()
    client.markOpening()
    client.markOpen(READY, 0, 'replacement-record')
    client.enqueue('fresh typing')
    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce())
    expect(client.snapshot().error).toBeNull()
    expect(writer.mock.calls[0]?.[2]).toBe('fresh typing')
  })

  it('retains matching replacement readiness delivered before its spawning attach snapshot', async () => {
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementation(async (_owner, _id, data, identity) => accepted(data, identity, 'queued'))
    const client = testDispatcher(writer).acquire('session', 'terminal')
    client.markOpen({ phase: 'ready', generation: 9 }, 0, 'old-record')
    client.markOpening()
    client.markReady(READY, 'replacement-record')
    client.markOpen({ phase: 'spawning', generation: 1 }, 0, 'replacement-record')
    client.enqueue('new')
    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce())
    expect(client.snapshot().waiting).toBe(false)
  })

  it('clears acknowledged startup waiting bytes when ready precedes a same-record attach snapshot', async () => {
    const writer = acceptingWriter()
    const client = testDispatcher(writer).acquire('session', 'terminal')
    client.markOpen({ phase: 'awaiting-prompt', generation: 1 }, 20, 'same-record')
    expect(client.snapshot().waiting).toBe(true)
    client.markOpening()
    client.markReady(READY, 'same-record')
    client.markOpen({ phase: 'awaiting-prompt', generation: 1 }, 20, 'same-record')
    expect(client.snapshot().waiting).toBe(false)
  })

  it('keeps a matching ready proof when failed Restart rolls back to the original record', () => {
    const client = testDispatcher(acceptingWriter()).acquire('session', 'terminal')
    client.markOpen({ phase: 'awaiting-prompt', generation: 1 }, 20, 'same-record')
    const rollback = client.markOpening()
    client.markReady(READY, 'same-record')
    rollback()
    expect(client.snapshot().waiting).toBe(false)
  })

  it('ignores late readiness from the old record even with a higher spawn generation', async () => {
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementation(async (_owner, _id, data, identity) => accepted(data, identity, 'queued'))
    const client = testDispatcher(writer).acquire('session', 'terminal')
    client.markOpen({ phase: 'spawning', generation: 1 }, 0, 'new-record')
    client.markReady({ phase: 'ready', generation: 99 }, 'old-record')
    client.enqueue('new')
    await vi.waitFor(() => expect(client.snapshot().waiting).toBe(true))
  })

  it('does not let an old drain finalizer release the replacement drain lock', async () => {
    const oldAck = deferredWriteResult()
    const newAck = deferredWriteResult()
    const writer = acceptingWriter()
    writer.mockImplementationOnce(() => oldAck.promise).mockImplementationOnce(() => newAck.promise)
    const client = testDispatcher(writer).acquire('session', 'terminal')
    client.markOpen(READY, 0, 'old-record')
    client.enqueue('old')
    client.markOpening()
    client.markOpen(READY, 0, 'new-record')
    client.markOpening()
    client.markOpen(READY, 0, 'new-record')
    client.enqueue('new-first')
    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(2))
    const oldIdentity = writer.mock.calls[0]?.[3]
    const newIdentity = writer.mock.calls[1]?.[3]
    if (!oldIdentity || !newIdentity) throw new Error('Expected both delivery identities')
    oldAck.resolve(accepted('old', oldIdentity))
    await Promise.resolve()
    await Promise.resolve()
    client.enqueue('new-second')
    expect(writer).toHaveBeenCalledTimes(2)
    newAck.resolve(accepted('new-first', newIdentity))
    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(3))
    expect(writer.mock.calls.map((call) => [call[2], call[3].sequence])).toEqual([
      ['old', 0],
      ['new-first', 0],
      ['new-second', 1],
    ])
  })
})
