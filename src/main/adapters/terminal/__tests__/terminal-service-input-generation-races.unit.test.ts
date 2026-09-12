import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  feed,
  OWNER,
  openInput,
  ptys,
  readinessMarker,
  service,
  settle,
  setupTerminalServiceActionsTest,
  TERMINAL_ID,
  TERMINAL_KEY,
  teardownTerminalServiceActionsTest,
  workDirA,
} from './terminal-service-actions-test-harness'

describe('makeNodePtyTerminalService input generation lifecycle races', () => {
  beforeEach(setupTerminalServiceActionsTest)
  afterEach(teardownTerminalServiceActionsTest)

  it('retains restart-racing input when a renderer reload activates a new generation', async () => {
    const firstGeneration = 'renderer-before-reload'
    const nextGeneration = 'renderer-after-reload'
    const identity = { generation: firstGeneration, sequence: 0 } as const
    await Effect.runPromise(
      service.open({ ...openInput(workDirA), inputGeneration: firstGeneration }),
    )
    await settle()
    feed(0, readinessMarker(0))
    const first = ptys[0]
    if (first === undefined) throw new Error('Expected first PTY')
    first.closeDescriptor.mockImplementationOnce(() => undefined)

    const restarting = Effect.runPromise(
      service.restart({ ...openInput(workDirA), inputGeneration: firstGeneration }),
    )
    const writing = Effect.runPromise(
      service.write(OWNER, TERMINAL_ID, 'held across reload', identity),
    )
    const retryingAmbiguousWrite = Effect.runPromise(
      service.write(OWNER, TERMINAL_ID, 'held across reload', identity),
    )
    await vi.advanceTimersByTimeAsync(0)
    const reattaching = Effect.runPromise(
      service.open({ ...openInput(workDirA), inputGeneration: nextGeneration }),
    )
    first.emitExit(0)

    await expect(restarting).resolves.toMatchObject({ running: true })
    await expect(reattaching).resolves.toMatchObject({ running: true })
    await expect(writing).resolves.toEqual({
      status: 'queued',
      acceptedBytes: 18,
      identity,
    })
    await expect(retryingAmbiguousWrite).resolves.toEqual({
      status: 'queued',
      acceptedBytes: 18,
      identity,
    })
    await settle()
    feed(1, readinessMarker(1))
    expect(ptys[0]?.write).not.toHaveBeenCalledWith('held across reload')
    expect(ptys[1]?.write).toHaveBeenCalledExactlyOnceWith('held across reload')
  })

  it('keeps the newest invoked renderer generation while an older lifecycle body resumes', async () => {
    const firstGeneration = 'renderer-a'
    const nextGeneration = 'renderer-b'
    const firstIdentity = { generation: firstGeneration, sequence: 0 } as const
    const nextIdentity = { generation: nextGeneration, sequence: 0 } as const
    await Effect.runPromise(
      service.open({ ...openInput(workDirA), inputGeneration: firstGeneration }),
    )
    await settle()
    feed(0, readinessMarker(0))
    const first = ptys[0]
    if (first === undefined) throw new Error('Expected first PTY')
    first.closeDescriptor.mockImplementationOnce(() => undefined)

    const flush = Promise.withResolvers<void>()
    service.history.flush = vi.fn(() => flush.promise)
    const clearing = Effect.runPromise(service.clear(OWNER, TERMINAL_ID))
    await vi.advanceTimersByTimeAsync(0)
    const restarting = Effect.runPromise(
      service.restart({ ...openInput(workDirA), inputGeneration: firstGeneration }),
    )
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'accepted by a', firstIdentity)),
    ).resolves.toEqual({
      status: 'queued',
      acceptedBytes: 13,
      identity: firstIdentity,
    })

    const openingNextRenderer = Effect.runPromise(
      service.open({ ...openInput(workDirA), inputGeneration: nextGeneration }),
    )
    await vi.waitFor(() => {
      expect(service.records.get(TERMINAL_KEY)?.inputGeneration).toBe(nextGeneration)
    })
    flush.resolve()
    await clearing
    await vi.waitFor(() => expect(first.closeDescriptor).toHaveBeenCalledOnce())

    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'late from a', firstIdentity)),
    ).resolves.toEqual({
      status: 'rejected',
      acceptedBytes: 0,
      reason: 'stale-generation',
      identity: firstIdentity,
    })
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'accepted by b', nextIdentity)),
    ).resolves.toEqual({
      status: 'queued',
      acceptedBytes: 13,
      identity: nextIdentity,
    })

    first.emitExit(0)
    await expect(restarting).resolves.toMatchObject({ running: true })
    await expect(openingNextRenderer).resolves.toMatchObject({ running: true })
    await settle()
    feed(1, readinessMarker(1))
    expect(ptys[1]?.write.mock.calls).toEqual([['accepted by a'], ['accepted by b']])
  })

  it('keeps acknowledged lifecycle input queued when restart fails', async () => {
    const inputGeneration = 'renderer-restart-failure'
    const identity = { generation: inputGeneration, sequence: 0 } as const
    await Effect.runPromise(service.open({ ...openInput(workDirA), inputGeneration }))
    await settle()
    feed(0, readinessMarker(0))
    const truncate = Promise.withResolvers<void>()
    service.history.truncate = vi.fn(() => truncate.promise)

    const restarting = Effect.runPromise(
      service.restart({ ...openInput(workDirA), inputGeneration }),
    )
    await vi.waitFor(() => expect(service.history.truncate).toHaveBeenCalledOnce())
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'retained after failure', identity)),
    ).resolves.toEqual({
      status: 'queued',
      acceptedBytes: 22,
      identity,
    })
    truncate.reject(new Error('history unavailable'))

    await expect(restarting).rejects.toThrow('history unavailable')
    expect(service.records.get(TERMINAL_KEY)?.pendingInputBytes).toBe(22)
    service.history.truncate = vi.fn(() => Promise.resolve())

    await Effect.runPromise(service.restart({ ...openInput(workDirA), inputGeneration }))
    await settle()
    feed(1, readinessMarker(1))
    expect(ptys[0]?.write).not.toHaveBeenCalledWith('retained after failure')
    expect(ptys[1]?.write).toHaveBeenCalledExactlyOnceWith('retained after failure')
  })

  it('does not deliver staged lifecycle input through an explicit close fence', async () => {
    const inputGeneration = 'renderer-closing-restart'
    const identity = { generation: inputGeneration, sequence: 0 } as const
    await Effect.runPromise(service.open({ ...openInput(workDirA), inputGeneration }))
    await settle()
    feed(0, readinessMarker(0))
    const first = ptys[0]
    if (first === undefined) throw new Error('Expected first PTY')
    first.closeDescriptor.mockImplementationOnce(() => undefined)

    const restarting = Effect.runPromise(
      service.restart({ ...openInput(workDirA), inputGeneration }),
    )
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'discarded by close', identity)),
    ).resolves.toMatchObject({ status: 'queued', identity })
    const closing = Effect.runPromise(service.close(OWNER, TERMINAL_ID, false))
    first.emitExit(0)

    await expect(restarting).resolves.toMatchObject({ running: true })
    await settle()
    await closing
    expect(service.records.has(TERMINAL_KEY)).toBe(false)
    expect(ptys[0]?.write).not.toHaveBeenCalledWith('discarded by close')
    expect(ptys[1]?.write).not.toHaveBeenCalledWith('discarded by close')
  })
})
