import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalInputIdentity } from '@shared/types/terminal'
import { describe, expect, it, vi } from 'vitest'
import {
  accepted,
  deferredWriteResult,
  READY,
  type TerminalInputWriter,
  testDispatcher,
} from './terminal-input-dispatcher-test-harness'

describe('terminal input dispatcher Project Actions', () => {
  it('keeps one Project Action atomic and orders later typing behind its acknowledgement', async () => {
    const actionWrite = deferredWriteResult()
    let actionIdentity: TerminalInputIdentity | null = null
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementationOnce((_owner, _id, _data, identity) => {
        actionIdentity = identity
        return actionWrite.promise
      })
      .mockImplementation(async (_owner, _id, data, identity) => accepted(data, identity))
    const dispatcher = testDispatcher(writer)
    const client = dispatcher.acquire('session-1', 'terminal-1')
    const command = `${'x'.repeat(TERMINAL.MAX_INPUT_BYTES + 17)}\r`
    client.markOpen(READY)

    const action = client.enqueueProjectAction(command, 'execution-1')
    expect(client.enqueue('typed-after-action')).toEqual({ status: 'accepted' })
    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce())
    expect(writer.mock.calls[0]?.[2]).toBe(command)
    expect(writer.mock.calls[0]?.[4]).toEqual({
      kind: 'project-action',
      executionId: 'execution-1',
    })
    expect(dispatcher.hasPendingProjectAction('session-1', 'terminal-1')).toBe(true)

    if (actionIdentity === null) throw new Error('Expected the Project Action identity')
    actionWrite.resolve(accepted(command, actionIdentity))

    await expect(action).resolves.toEqual({ status: 'accepted' })
    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(2))
    expect(writer.mock.calls[1]?.[2]).toBe('typed-after-action')
    expect(writer.mock.calls.map((call) => call[3].sequence)).toEqual([0, 1])
    expect(dispatcher.hasPendingProjectAction('session-1', 'terminal-1')).toBe(false)
  })

  it('drops a main barrier rejection without consuming sequence or blocking later typing', async () => {
    const identities: TerminalInputIdentity[] = []
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementation(async (_owner, _id, data, identity, intent) => {
        identities.push(identity)
        if (intent?.kind === 'project-action') {
          return {
            status: 'rejected',
            acceptedBytes: 0,
            reason: 'project-action-pending',
            identity,
          }
        }
        return accepted(data, identity)
      })
    const client = testDispatcher(writer).acquire('session-1', 'terminal-1')
    client.markOpen(READY)

    const action = client.enqueueProjectAction('pnpm test\r', 'execution-2')
    client.enqueue('ordinary-input')

    await expect(action).resolves.toMatchObject({
      status: 'rejected',
      reason: 'project-action-pending',
    })
    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(2))
    expect(writer.mock.calls.map((call) => call[2])).toEqual(['pnpm test\r', 'ordinary-input'])
    expect(identities.map((identity) => identity.sequence)).toEqual([0, 0])
    expect(client.snapshot()).toMatchObject({ error: null, queuedChunks: 0 })
  })

  it('settles a queued Project Action when its runtime is closed', async () => {
    const writer = vi.fn<TerminalInputWriter>()
    const dispatcher = testDispatcher(writer)
    const client = dispatcher.acquire('session-1', 'terminal-1')
    const action = client.enqueueProjectAction('pnpm test\r', 'execution-3')

    client.markClosed()

    await expect(action).resolves.toMatchObject({ status: 'rejected', reason: 'inactive' })
    expect(dispatcher.hasPendingProjectAction('session-1', 'terminal-1')).toBe(false)
    expect(writer).not.toHaveBeenCalled()
  })

  it('migrates a queued Project Action with the ordered runtime', async () => {
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementation(async (_owner, _id, data, identity) => accepted(data, identity))
    const dispatcher = testDispatcher(writer)
    const draft = dispatcher.acquire('draft:/repo', 'terminal-1')
    const action = draft.enqueueProjectAction('pnpm test\r', 'execution-4')

    dispatcher.migrateOwner('draft:/repo', 'session-1', ['terminal-1'])
    draft.release()
    const session = dispatcher.acquire('session-1', 'terminal-1')
    session.markOpen(READY)

    await expect(action).resolves.toEqual({ status: 'accepted' })
    expect(writer).toHaveBeenCalledWith(
      'session-1',
      'terminal-1',
      'pnpm test\r',
      { generation: 'input-generation-1', sequence: 0 },
      { kind: 'project-action', executionId: 'execution-4' },
    )
  })

  it('keeps an ambiguously acknowledged Project Action for an exact-identity retry', async () => {
    const identities: TerminalInputIdentity[] = []
    const writer = vi
      .fn<TerminalInputWriter>()
      .mockImplementation(async (_owner, _id, data, identity) => {
        identities.push(identity)
        if (identities.length === 1) {
          return { status: 'written', acceptedBytes: 1, identity }
        }
        return accepted(data, identity)
      })
    const dispatcher = testDispatcher(writer)
    const client = dispatcher.acquire('session-1', 'terminal-1')
    client.markOpen(READY)

    const action = client.enqueueProjectAction('pnpm test\r', 'execution-5')

    await expect(action).resolves.toMatchObject({ status: 'rejected', reason: 'transport' })
    expect(dispatcher.hasPendingProjectAction('session-1', 'terminal-1')).toBe(true)
    client.retry()
    await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(2))
    expect(identities).toEqual([
      { generation: 'input-generation-1', sequence: 0 },
      { generation: 'input-generation-1', sequence: 0 },
    ])
    expect(dispatcher.hasPendingProjectAction('session-1', 'terminal-1')).toBe(false)
  })
})
