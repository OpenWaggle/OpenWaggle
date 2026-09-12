import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  events,
  failNextMove,
  feed,
  moves,
  openInput,
  ptys,
  readinessMarker,
  service,
  settle,
  setupTerminalServiceActionsTest,
  spawn,
  TERMINAL_ID,
  teardownTerminalServiceActionsTest,
  workDirA,
} from './terminal-service-actions-test-harness'

describe('makeNodePtyTerminalService ownership and close', () => {
  beforeEach(setupTerminalServiceActionsTest)
  afterEach(teardownTerminalServiceActionsTest)

  it('atomically rekeys a draft owner without restarting its PTY or losing history', async () => {
    const draftOwner = 'draft:/repo'
    const sessionOwner = 'session-born'
    const draftKey = `${draftOwner}::${TERMINAL_ID}`
    const sessionKey = `${sessionOwner}::${TERMINAL_ID}`
    await Effect.runPromise(service.open({ ...openInput(workDirA), ownerKey: draftOwner }))
    await settle()
    ptys[0]?.dataListeners[0]?.('draft output')
    await service.history.flush()

    const result = await Effect.runPromise(service.migrateOwner(draftOwner, sessionOwner))

    expect(result).toEqual({ terminalIds: [TERMINAL_ID] })
    expect(service.records.has(draftKey)).toBe(false)
    expect(service.records.get(sessionKey)?.live?.pty).toBe(ptys[0]?.pty)
    expect(service.records.get(sessionKey)?.scrollback.toString()).toBe('draft output')
    expect(moves).toEqual([[draftKey, sessionKey]])
    await expect(service.history.read(draftKey)).resolves.toBe('')
    await expect(service.history.read(sessionKey)).resolves.toBe('draft output')
    expect(ptys[0]?.kill).not.toHaveBeenCalled()
  })

  it('rejects owner migration collisions before mutating either terminal', async () => {
    const draftOwner = 'draft:/repo'
    const sessionOwner = 'session-existing'
    const draftKey = `${draftOwner}::${TERMINAL_ID}`
    const sessionKey = `${sessionOwner}::${TERMINAL_ID}`
    await Effect.runPromise(service.open({ ...openInput(workDirA), ownerKey: draftOwner }))
    await Effect.runPromise(service.open({ ...openInput(workDirA), ownerKey: sessionOwner }))
    await settle()

    await expect(Effect.runPromise(service.migrateOwner(draftOwner, sessionOwner))).rejects.toThrow(
      `destination ${sessionKey} exists`,
    )

    expect(service.records.get(draftKey)?.live?.pty).toBe(ptys[0]?.pty)
    expect(service.records.get(sessionKey)?.live?.pty).toBe(ptys[1]?.pty)
    expect(moves).toEqual([])
  })

  it('rolls history and paused runtime state back when attachment migration fails', async () => {
    const draftOwner = 'draft:/repo'
    const sessionOwner = 'session-born'
    const draftKey = `${draftOwner}::${TERMINAL_ID}`
    const sessionKey = `${sessionOwner}::${TERMINAL_ID}`
    await Effect.runPromise(service.open({ ...openInput(workDirA), ownerKey: draftOwner }))
    await settle()
    ptys[0]?.dataListeners[0]?.('draft output')
    await service.history.flush()
    failNextMove(new Error('surface move failed'))

    await expect(Effect.runPromise(service.migrateOwner(draftOwner, sessionOwner))).rejects.toThrow(
      'surface move failed',
    )

    expect(service.records.get(draftKey)?.live?.pty).toBe(ptys[0]?.pty)
    expect(service.records.has(sessionKey)).toBe(false)
    expect(service.records.get(draftKey)?.ownerMigration).toBeNull()
    expect(service.records.get(draftKey)?.live?.outputPaused).toBe(false)
    await expect(service.history.read(draftKey)).resolves.toBe('draft output')
    await expect(service.history.read(sessionKey)).resolves.toBe('')
  })

  it('keeps PTY output paused until owner migration finishes even when an ack drains it', async () => {
    const draftOwner = 'draft:/repo'
    const sessionOwner = 'session-born'
    let finishHistoryMove: (() => void) | undefined
    let reportHistoryMoveStarted: (() => void) | undefined
    const historyMoveStarted = new Promise<void>((resolve) => {
      reportHistoryMoveStarted = resolve
    })
    service.history.moveOwner = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishHistoryMove = resolve
          reportHistoryMoveStarted?.()
        }),
    )
    await Effect.runPromise(service.open({ ...openInput(workDirA), ownerKey: draftOwner }))
    await settle()
    ptys[0]?.resumeOutput.mockClear()
    ptys[0]?.dataListeners[0]?.('pending delivery')

    const migrating = Effect.runPromise(service.migrateOwner(draftOwner, sessionOwner))
    await historyMoveStarted
    const output = events.findLast((payload) => payload.event.type === 'output')?.event
    if (output?.type !== 'output') throw new Error('Expected in-flight terminal output')

    await Effect.runPromise(
      service.acknowledgeOutput(draftOwner, TERMINAL_ID, output.outputGeneration, output.endOffset),
    )
    expect(ptys[0]?.resumeOutput).not.toHaveBeenCalled()

    finishHistoryMove?.()
    await migrating
    expect(ptys[0]?.resumeOutput).toHaveBeenCalledOnce()
  })

  it('retries a close issued during owner migration against the destination key', async () => {
    const draftOwner = 'draft:/repo'
    const sessionOwner = 'session-born'
    let finishHistoryMove: (() => void) | undefined
    let reportHistoryMoveStarted: (() => void) | undefined
    const historyMoveStarted = new Promise<void>((resolve) => {
      reportHistoryMoveStarted = resolve
    })
    service.history.moveOwner = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishHistoryMove = resolve
          reportHistoryMoveStarted?.()
        }),
    )
    await Effect.runPromise(service.open({ ...openInput(workDirA), ownerKey: draftOwner }))
    await settle()

    const migrating = Effect.runPromise(service.migrateOwner(draftOwner, sessionOwner))
    await historyMoveStarted
    const closing = Effect.runPromise(service.close(draftOwner, TERMINAL_ID, false))
    finishHistoryMove?.()

    await migrating
    await closing
    expect(service.records.has(`${sessionOwner}::${TERMINAL_ID}`)).toBe(false)
    expect(ptys[0]?.closeDescriptor).toHaveBeenCalledOnce()
    expect(ptys[0]?.kill).not.toHaveBeenCalled()
  })

  it('retries Clear issued during owner migration instead of silently dropping it', async () => {
    const draftOwner = 'draft:/repo'
    const sessionOwner = 'session-born'
    let finishHistoryMove: (() => void) | undefined
    let reportHistoryMoveStarted: (() => void) | undefined
    const historyMoveStarted = new Promise<void>((resolve) => {
      reportHistoryMoveStarted = resolve
    })
    service.history.moveOwner = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishHistoryMove = resolve
          reportHistoryMoveStarted?.()
        }),
    )
    await Effect.runPromise(service.open({ ...openInput(workDirA), ownerKey: draftOwner }))
    await settle()
    feed(0, 'draft output')

    const migrating = Effect.runPromise(service.migrateOwner(draftOwner, sessionOwner))
    await historyMoveStarted
    const clearing = Effect.runPromise(service.clear(draftOwner, TERMINAL_ID))
    finishHistoryMove?.()

    await migrating
    await clearing
    expect(service.records.get(`${sessionOwner}::${TERMINAL_ID}`)?.scrollback.toString()).toBe('')
    expect(events).toContainEqual({
      ownerKey: sessionOwner,
      terminalId: TERMINAL_ID,
      event: { type: 'cleared', outputGeneration: 2 },
    })
  })

  it('retries Restart issued during owner migration and keeps the pane running', async () => {
    const draftOwner = 'draft:/repo'
    const sessionOwner = 'session-born'
    let finishHistoryMove: (() => void) | undefined
    let reportHistoryMoveStarted: (() => void) | undefined
    const historyMoveStarted = new Promise<void>((resolve) => {
      reportHistoryMoveStarted = resolve
    })
    service.history.moveOwner = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishHistoryMove = resolve
          reportHistoryMoveStarted?.()
        }),
    )
    await Effect.runPromise(service.open({ ...openInput(workDirA), ownerKey: draftOwner }))
    await settle()

    const migrating = Effect.runPromise(service.migrateOwner(draftOwner, sessionOwner))
    await historyMoveStarted
    const restarting = Effect.runPromise(
      service.restart({ ...openInput(workDirA), ownerKey: draftOwner }),
    )
    finishHistoryMove?.()

    await migrating
    await restarting
    await settle()
    expect(service.records.get(`${sessionOwner}::${TERMINAL_ID}`)?.live?.pty).toBe(ptys[1]?.pty)
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('holds input behind owner migration and resolves it against the destination key', async () => {
    const draftOwner = 'draft:/repo'
    const sessionOwner = 'session-born'
    const historyMove = Promise.withResolvers<void>()
    const historyMoveStarted = Promise.withResolvers<void>()
    service.history.moveOwner = vi.fn(() => {
      historyMoveStarted.resolve()
      return historyMove.promise
    })
    await Effect.runPromise(service.open({ ...openInput(workDirA), ownerKey: draftOwner }))
    await settle()
    feed(0, readinessMarker(0))

    const migrating = Effect.runPromise(service.migrateOwner(draftOwner, sessionOwner))
    await historyMoveStarted.promise
    const writing = Effect.runPromise(service.write(draftOwner, TERMINAL_ID, 'after migration'))
    let writeSettled = false
    void writing.then(() => {
      writeSettled = true
    })
    await settle()

    expect(writeSettled).toBe(false)
    expect(ptys[0]?.write).not.toHaveBeenCalledWith('after migration')

    historyMove.resolve()
    await migrating
    await expect(writing).resolves.toEqual({ status: 'written', acceptedBytes: 15 })
    expect(service.records.has(`${draftOwner}::${TERMINAL_ID}`)).toBe(false)
    expect(service.records.has(`${sessionOwner}::${TERMINAL_ID}`)).toBe(true)
    expect(ptys[0]?.write).toHaveBeenCalledExactlyOnceWith('after migration')
  })

  it('drains launch-staged input through the owner alias after migration', async () => {
    const draftOwner = 'draft:/repo'
    const sessionOwner = 'session-born'
    const inputGeneration = 'renderer-migrating-launch'
    const identity = { generation: inputGeneration, sequence: 0 } as const
    await Effect.runPromise(
      service.open({ ...openInput(workDirA), ownerKey: draftOwner, inputGeneration }),
    )
    await settle()
    feed(0, readinessMarker(0))
    const flush = Promise.withResolvers<void>()
    service.history.flush = vi.fn(() => flush.promise)

    const clearing = Effect.runPromise(service.clear(draftOwner, TERMINAL_ID))
    await vi.advanceTimersByTimeAsync(0)
    const reopening = Effect.runPromise(
      service.open({ ...openInput(workDirA), ownerKey: draftOwner, inputGeneration }),
    )
    await expect(
      Effect.runPromise(
        service.write(draftOwner, TERMINAL_ID, 'staged before migration', identity),
      ),
    ).resolves.toMatchObject({ status: 'queued', identity })
    const migrating = Effect.runPromise(service.migrateOwner(draftOwner, sessionOwner))
    flush.resolve()

    await Promise.all([clearing, reopening, migrating])
    await settle()
    expect(service.records.has(`${draftOwner}::${TERMINAL_ID}`)).toBe(false)
    expect(service.records.get(`${sessionOwner}::${TERMINAL_ID}`)?.pendingInputBytes).toBe(0)
    expect(ptys[0]?.write).toHaveBeenCalledExactlyOnceWith('staged before migration')
  })
})
