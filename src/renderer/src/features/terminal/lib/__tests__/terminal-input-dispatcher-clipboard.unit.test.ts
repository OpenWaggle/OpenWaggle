import { describe, expect, it, vi } from 'vitest'
import {
  accepted,
  deferredText,
  READY,
  type TerminalInputWriter,
  testDispatcher,
} from './terminal-input-dispatcher-test-harness'

describe('terminal input dispatcher clipboard ordering', () => {
  it('serializes clipboard resolutions across a same-runtime remount', async () => {
    const firstRead = deferredText()
    const secondRead = vi.fn(async () => 'second')
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementation(async (_owner, _id, data, id) => accepted(data, id))
    const dispatcher = testDispatcher(writer)
    const source = dispatcher.acquire('session-1', 'terminal-1')
    source.markOpen(READY)
    const firstPaste = source.enqueueAsync(() => firstRead.promise)

    source.release()
    const destination = dispatcher.acquire('session-1', 'terminal-1')
    destination.markOpen(READY)
    const secondPaste = destination.enqueueAsync(secondRead)
    await Promise.resolve()
    expect(secondRead).not.toHaveBeenCalled()

    firstRead.resolve('first')
    await Promise.all([firstPaste, secondPaste])
    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(2))
    expect(writer.mock.calls.map((call) => call[2])).toEqual(['first', 'second'])
    expect(writer.mock.calls.map((call) => call[3].sequence)).toEqual([0, 1])
  })

  it('keeps synchronous typing behind an earlier unresolved clipboard read', async () => {
    const clipboard = deferredText()
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementation(async (_owner, _id, data, id) => accepted(data, id))
    const client = testDispatcher(writer).acquire('session-1', 'terminal-1')
    client.markOpen(READY)

    const paste = client.enqueueAsync(() => clipboard.promise)
    expect(client.enqueue('typed-after-paste')).toEqual({ status: 'accepted' })
    await Promise.resolve()

    expect(writer).not.toHaveBeenCalled()
    clipboard.resolve('clipboard-first')
    await paste
    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(2))
    expect(writer.mock.calls.map((call) => call[2])).toEqual([
      'clipboard-first',
      'typed-after-paste',
    ])
    expect(writer.mock.calls.map((call) => call[3].sequence)).toEqual([0, 1])
  })

  it('atomically caps pending async clipboard operations', async () => {
    const firstRead = deferredText()
    const secondRead = vi.fn(async () => 'second')
    const rejectedRead = vi.fn(async () => 'rejected')
    const writer = vi.fn<TerminalInputWriter>()
    const client = testDispatcher(writer, undefined, 2).acquire('session-1', 'terminal-1')
    const first = client.enqueueAsync(() => firstRead.promise)
    const second = client.enqueueAsync(secondRead)

    await expect(client.enqueueAsync(rejectedRead)).resolves.toMatchObject({
      status: 'rejected',
      reason: 'capacity',
    })
    expect(rejectedRead).not.toHaveBeenCalled()
    expect(secondRead).not.toHaveBeenCalled()
    expect(client.snapshot()).toMatchObject({ waiting: false })
    expect(client.snapshot().error).toContain('clipboard reads are pending')

    firstRead.resolve('')
    await Promise.all([first, second])
  })
})
