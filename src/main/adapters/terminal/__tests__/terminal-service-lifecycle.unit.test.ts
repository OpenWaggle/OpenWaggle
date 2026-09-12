import { promises as fs } from 'node:fs'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  expectEvent,
  feed,
  OUTPUT_FLUSH_MS,
  OWNER,
  open,
  openInput,
  ptys,
  readinessMarker,
  service,
  settle,
  setupTerminalServiceActionsTest,
  spawn,
  TERMINAL_ID,
  TERMINAL_KEY,
  teardownTerminalServiceActionsTest,
  workDirA,
  workDirB,
} from './terminal-service-actions-test-harness'

describe('makeNodePtyTerminalService lifecycle', () => {
  beforeEach(setupTerminalServiceActionsTest)
  afterEach(teardownTerminalServiceActionsTest)

  it('restart resets the stream to zero bytes and spawns a fresh shell', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'before-restart')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)

    const result = await Effect.runPromise(service.restart(openInput(workDirA)))

    expect(result).toMatchObject({
      history: '',
      outputBytes: 0,
      outputGeneration: 2,
      running: true,
    })
    expect(spawn).toHaveBeenCalledTimes(2)
    const record = service.records.get(TERMINAL_KEY)
    expect(record?.scrollback.toString()).toBe('')
    expect(record?.outputBytes).toBe(0)
    await settle()
    expect(record?.live?.pty).toBe(ptys[1]?.pty)
  })

  it('restart without env preserves the terminal record overrides', async () => {
    const env = {
      OPENWAGGLE_PROJECT_ROOT: '/project',
      T3CODE_PROJECT_ROOT: '/project',
    }
    await Effect.runPromise(service.open({ ...openInput(workDirA), env }))
    await settle()

    await Effect.runPromise(service.restart(openInput(workDirA)))

    expect(service.records.get(TERMINAL_KEY)?.env).toEqual(env)
    expect(spawn.mock.calls[1]?.[0].env).toEqual(env)
  })

  it('acknowledges input during a context change without writing to the old PTY', async () => {
    const inputGeneration = 'renderer-context-change'
    const identity = { generation: inputGeneration, sequence: 0 } as const
    const intent = { kind: 'project-action', executionId: 'action-context-change' } as const
    await Effect.runPromise(service.open({ ...openInput(workDirA), inputGeneration }))
    await settle()
    feed(0, readinessMarker(0))

    const flush = Promise.withResolvers<void>()
    service.history.flush = vi.fn(() => flush.promise)
    const clearing = Effect.runPromise(service.clear(OWNER, TERMINAL_ID))
    await vi.advanceTimersByTimeAsync(0)
    const reopening = Effect.runPromise(service.open({ ...openInput(workDirB), inputGeneration }))
    const writing = Effect.runPromise(
      service.write(OWNER, TERMINAL_ID, 'pnpm test\r', identity, intent),
    )
    await vi.advanceTimersByTimeAsync(0)
    await expect(writing).resolves.toEqual({
      status: 'queued',
      acceptedBytes: 10,
      identity,
    })
    expect(ptys[0]?.write).not.toHaveBeenCalledWith('pnpm test\r')

    flush.resolve()
    await Promise.all([clearing, reopening])
    await settle()
    expect(ptys[0]?.write).not.toHaveBeenCalledWith('pnpm test\r')
    feed(1, readinessMarker(1))
    expect(ptys[1]?.write).toHaveBeenCalledExactlyOnceWith('pnpm test\r')
  })

  it('holds same-turn input behind restart and delivers it only to the new PTY', async () => {
    await open(workDirA)
    await settle()
    feed(0, readinessMarker(0))

    const restarting = Effect.runPromise(service.restart(openInput(workDirA)))
    const writing = Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'after restart'))

    await expect(restarting).resolves.toMatchObject({ running: true })
    await settle()
    await expect(writing).resolves.toEqual({ status: 'queued', acceptedBytes: 13 })
    expect(ptys[0]?.write).not.toHaveBeenCalledWith('after restart')
    expect(ptys[1]?.write).not.toHaveBeenCalledWith('after restart')

    feed(1, readinessMarker(1))
    expect(ptys[1]?.write).toHaveBeenCalledExactlyOnceWith('after restart')
  })

  it('holds Send now behind restart and releases queued input only to the new PTY', async () => {
    await open(workDirA)
    await settle()
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'queued before restart')),
    ).resolves.toMatchObject({ status: 'queued' })

    const restarting = Effect.runPromise(service.restart(openInput(workDirA)))
    const releasing = Effect.runPromise(service.sendInputNow(OWNER, TERMINAL_ID))

    await expect(restarting).resolves.toMatchObject({ running: true })
    await settle()
    await expect(releasing).resolves.toEqual({ status: 'released', releasedBytes: 21 })
    expect(ptys[0]?.write).not.toHaveBeenCalledWith('queued before restart')
    expect(ptys[1]?.write).toHaveBeenCalledExactlyOnceWith('queued before restart')
  })

  it('holds input behind clear until durable history and the backend reset finish', async () => {
    await open(workDirA)
    await settle()
    feed(0, readinessMarker(0))

    const flush = Promise.withResolvers<void>()
    service.history.flush = vi.fn(() => flush.promise)
    const clearing = Effect.runPromise(service.clear(OWNER, TERMINAL_ID))
    const writing = Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'after clear'))
    let writeSettled = false
    void writing.then(() => {
      writeSettled = true
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(writeSettled).toBe(false)
    expect(ptys[0]?.write).not.toHaveBeenCalledWith('after clear')

    flush.resolve()
    await clearing
    await expect(writing).resolves.toEqual({ status: 'written', acceptedBytes: 11 })
    expect(ptys[0]?.clear.mock.invocationCallOrder[0]).toBeLessThan(
      ptys[0]?.write.mock.invocationCallOrder[0] ?? 0,
    )
    expect(ptys[0]?.write).toHaveBeenCalledExactlyOnceWith('after clear')
  })

  it('stops the previous live PTY when a context re-open targets a missing cwd', async () => {
    await open(workDirA)
    await settle()
    await fs.rm(workDirB, { recursive: true })

    await expect(service.open(openInput(workDirB)).pipe(Effect.runPromise)).resolves.toMatchObject({
      running: false,
      cwdMissing: true,
    })

    expect(ptys[0]?.closeDescriptor).toHaveBeenCalledOnce()
    expect(ptys[0]?.kill).not.toHaveBeenCalled()
    expect(service.records.get(TERMINAL_KEY)?.live).toBeNull()
    expect(spawn).toHaveBeenCalledOnce()
  })

  it('preserves acknowledged startup input across a restart', async () => {
    const inputGeneration = 'renderer-generation-a'
    const identity = { generation: inputGeneration, sequence: 0 } as const
    const input = { ...openInput(workDirA), inputGeneration }
    await Effect.runPromise(service.open(input))
    await settle()
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'typed-before-restart', identity)),
    ).resolves.toEqual({ status: 'queued', acceptedBytes: 20, identity })

    await Effect.runPromise(service.restart(input))
    await settle()
    await expect(
      Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'typed-before-restart', identity)),
    ).resolves.toEqual({ status: 'queued', acceptedBytes: 20, identity })

    expect(ptys[1]?.write).not.toHaveBeenCalled()
    feed(1, readinessMarker(1))
    expect(ptys[1]?.write).toHaveBeenCalledExactlyOnceWith('typed-before-restart')
  })

  it('does not reset or respawn until the previous PTY confirms exit', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'keep until exit')
    const first = ptys[0]
    if (first === undefined) throw new Error('Expected first PTY')
    first.closeDescriptor.mockImplementationOnce(() => undefined)

    const restarting = Effect.runPromise(service.restart(openInput(workDirA)))
    const writing = Effect.runPromise(service.write(OWNER, TERMINAL_ID, 'after confirmed exit'))
    let writeSettled = false
    void writing.then(() => {
      writeSettled = true
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(spawn).toHaveBeenCalledOnce()
    expect(service.records.get(TERMINAL_KEY)?.scrollback.toString()).toBe('keep until exit')
    expect(writeSettled).toBe(false)
    expect(first.write).not.toHaveBeenCalledWith('after confirmed exit')

    first.emitExit(0)
    await restarting
    await expect(writing).resolves.toEqual({ status: 'queued', acceptedBytes: 20 })
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(service.records.get(TERMINAL_KEY)?.scrollback.toString()).toBe('')
    feed(1, readinessMarker(1))
    expect(ptys[1]?.write).toHaveBeenCalledExactlyOnceWith('after confirmed exit')
  })

  it('does not reset or respawn between tree exit and the final native/public drain', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'before tree exit')
    const first = ptys[0]
    const record = service.records.get(TERMINAL_KEY)
    if (first === undefined || record === undefined) throw new Error('Expected first PTY')
    first.closeDescriptor.mockImplementationOnce(() => undefined)

    let settled = false
    const restarting = Effect.runPromise(service.restart(openInput(workDirA))).then((result) => {
      settled = true
      return result
    })
    await vi.waitFor(() => expect(first.closeDescriptor).toHaveBeenCalledOnce())
    first.emitProcessTreeExit(0)
    await vi.waitFor(() => expect(record.live).toBeNull())

    feed(0, ' and final buffered output')
    expect(record.scrollback.toString()).toBe('before tree exit and final buffered output')
    expect(spawn).toHaveBeenCalledOnce()
    expect(settled).toBe(false)

    first.resolveResourceDrain()
    await vi.advanceTimersByTimeAsync(0)
    expect(spawn).toHaveBeenCalledOnce()
    expect(settled).toBe(false)

    first.emitPublicExit(0)
    await expect(restarting).resolves.toMatchObject({ running: true, outputGeneration: 2 })
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(record.scrollback.toString()).toBe('')
  })

  it('clear resets offsets and history without writing to the shell stdin', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'clear me')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)
    expect(ptys[0]?.write).not.toHaveBeenCalled()

    await Effect.runPromise(service.clear(OWNER, TERMINAL_ID))

    const record = service.records.get(TERMINAL_KEY)
    const first = ptys[0]
    if (first === undefined) throw new Error('Expected first PTY')
    expect(record?.scrollback.toString()).toBe('')
    expect(record?.outputBytes).toBe(0)
    expect(first.write).not.toHaveBeenCalled()
    expect(first.clear).toHaveBeenCalledOnce()
    expect(first.pauseOutput.mock.invocationCallOrder[0]).toBeLessThan(
      first.clear.mock.invocationCallOrder[0] ?? 0,
    )
    expect(first.clear.mock.invocationCallOrder[0]).toBeLessThan(
      first.resumeOutput.mock.invocationCallOrder.at(-1) ?? 0,
    )
    expect(spawn).toHaveBeenCalledOnce()
    expectEvent({ type: 'cleared', outputGeneration: 2 })
    await vi.waitFor(
      async () => {
        await expect(service.history.read(TERMINAL_KEY)).resolves.toBe('')
      },
      { timeout: 10_000 },
    )
  })
})
