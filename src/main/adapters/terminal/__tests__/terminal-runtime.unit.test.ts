import { fromAny } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PtySpawnOutcome } from '../terminal-pty-runner'
import {
  addRecord,
  BEL,
  ESC,
  FAKE_PID,
  INPUT,
  makeFakePty,
  makeRuntime,
  setupTerminalRuntimeTest,
  successfulOutcome,
  teardownTerminalRuntimeTest,
} from './terminal-runtime-test-harness'

describe('makeTerminalRuntime spawn lifecycle', () => {
  beforeEach(setupTerminalRuntimeTest)
  afterEach(teardownTerminalRuntimeTest)

  it('builds a generation-aware registry record', () => {
    const { runtime } = makeRuntime(makeFakePty(FAKE_PID))

    const record = runtime.makeRecord(INPUT, INPUT.cwd)

    expect(record).toMatchObject({
      key: 'session-1::main',
      ownerKey: 'session-1',
      terminalId: 'main',
      cwd: INPUT.cwd,
      live: null,
      exitCode: null,
      spawnGeneration: 0,
      outputGeneration: 0,
      readinessPhase: 'spawning',
      readinessGeneration: 0,
      pendingInput: [],
      pendingInputBytes: 0,
      inputGeneration: null,
      lastInputReceipt: null,
      pendingOutput: '',
      pendingOutputBytes: 0,
    })
  })

  it('retains the bounded spawn metadata as shutdown identity and tty fallback', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, spawn } = makeRuntime(fake)
    const outcome = successfulOutcome(fake)
    if (!outcome.ok) throw outcome.error
    spawn.mockResolvedValue({
      ...outcome,
      processIdentity: { pid: FAKE_PID, startedAt: 'darwin:123:456' },
      ttyIdentity: 'darwin:16:456',
      processMetadata: Promise.resolve({
        pid: FAKE_PID,
        startedAt: 'darwin:123:456',
        tty: 'ttys456',
        ttyIdentity: 'darwin:16:456',
      }),
    })
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows, 'spawn-metadata')
    await vi.advanceTimersByTimeAsync(0)

    expect(record.live).toMatchObject({
      processIdentity: { pid: FAKE_PID, startedAt: 'darwin:123:456' },
      ttyIdentity: 'darwin:16:456',
      tty: 'ttys456',
    })
  })

  it('generation-guards late data as well as late exit', async () => {
    const first = makeFakePty(FAKE_PID)
    const second = makeFakePty(FAKE_PID + 1)
    const { runtime, spawn, emitted, onLivePidsChanged } = makeRuntime(first)
    spawn
      .mockResolvedValueOnce(successfulOutcome(first, 'openwaggle-definitely-closed-test-tty'))
      .mockResolvedValueOnce(successfulOutcome(second))
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows, 'first-generation')
    await vi.advanceTimersByTimeAsync(0)
    first.dataListeners[0]?.('first')
    await runtime.killLive(record)
    runtime.spawn(record, INPUT.cols, INPUT.rows, 'second-generation')
    await vi.advanceTimersByTimeAsync(0)
    const beforeLateData = record.scrollback.toString()
    const outputBytesBeforeLateData = record.outputBytes

    first.dataListeners[0]?.(`stale${ESC}]633;B${BEL}`)
    first.exitListeners[0]?.({ exitCode: 9 })

    expect(record.scrollback.toString()).toBe(beforeLateData)
    expect(record.outputBytes).toBe(outputBytesBeforeLateData)
    expect(record.readinessPhase).toBe('awaiting-prompt')
    expect(record.live?.pty).toBe(second.pty)
    expect(emitted.some((payload) => payload.event.type === 'exited')).toBe(false)
    expect(onLivePidsChanged).toHaveBeenCalledTimes(4)
  })

  it('emits failed exit only for the current spawn generation', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, spawn, emitted } = makeRuntime(fake)
    spawn.mockResolvedValue({ ok: false, error: new Error('no shell available') })
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)

    expect(record.exitCode).toBe(-1)
    expect(emitted).toContainEqual({
      ownerKey: INPUT.ownerKey,
      terminalId: INPUT.terminalId,
      event: { type: 'exited', exitCode: -1 },
    })
  })

  it('normalizes a malformed native exit payload before storing or emitting it', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, emitted } = makeRuntime(fake)
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)
    fake.exitListeners[0]?.(fromAny({ exitCode: undefined }))
    await vi.advanceTimersByTimeAsync(0)

    expect(record.exitCode).toBe(-1)
    expect(emitted).toContainEqual({
      ownerKey: INPUT.ownerKey,
      terminalId: INPUT.terminalId,
      event: { type: 'exited', exitCode: -1 },
    })
  })

  it('kills a stale asynchronous spawn outcome when a newer generation wins', async () => {
    const first = makeFakePty(111)
    const second = makeFakePty(FAKE_PID)
    const { runtime, spawn } = makeRuntime(second)
    const record = addRecord(runtime)
    let resolveFirst: ((outcome: PtySpawnOutcome) => void) | undefined
    spawn.mockImplementationOnce(
      () =>
        new Promise<PtySpawnOutcome>((resolve) => {
          resolveFirst = resolve
        }),
    )

    runtime.spawn(record, INPUT.cols, INPUT.rows)
    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)
    resolveFirst?.(successfulOutcome(first))
    await vi.advanceTimersByTimeAsync(0)

    // Detached stale spawns are inspected before shutdown so their children
    // cannot escape. The process-table probe is asynchronous even though the
    // stale generation was identified synchronously.
    await vi.waitFor(() => expect(first.destroy).toHaveBeenCalledOnce())
    expect(first.kill).not.toHaveBeenCalled()
    expect(record.live?.pty).toBe(second.pty)
  })

  it('retains an unconfirmed stale spawn for app-shutdown retry', async () => {
    const first = makeFakePty(111)
    const second = makeFakePty(FAKE_PID)
    const shutdownDetachedProcess = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => {
        first.emitExit(0)
        return true
      })
    const { runtime, spawn } = makeRuntime(second, 1, { shutdownDetachedProcess })
    const record = addRecord(runtime)
    let resolveFirst: ((outcome: PtySpawnOutcome) => void) | undefined
    spawn.mockImplementationOnce(
      () =>
        new Promise<PtySpawnOutcome>((resolve) => {
          resolveFirst = resolve
        }),
    )

    runtime.spawn(record, INPUT.cols, INPUT.rows)
    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)
    resolveFirst?.(successfulOutcome(first))
    await vi.waitFor(() => expect(shutdownDetachedProcess).toHaveBeenCalledOnce())

    await expect(runtime.shutdownDetachedProcesses()).resolves.toBe(true)
    expect(shutdownDetachedProcess).toHaveBeenCalledTimes(2)
    expect(shutdownDetachedProcess.mock.calls[1]?.[0].live.pty).toBe(first.pty)
  })

  it('transfers a naturally exited PTY and every observed identity into retained ownership', async () => {
    const fake = makeFakePty(FAKE_PID)
    const shutdownDetachedProcess = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { runtime } = makeRuntime(fake, 1, { shutdownDetachedProcess })
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows, 'retained-natural-exit')
    await vi.advanceTimersByTimeAsync(0)
    record.activity = {
      processName: 'worker',
      processNames: ['worker'],
      ports: [],
      processPids: [FAKE_PID, FAKE_PID + 1],
      processIdentities: [FAKE_PID, FAKE_PID + 1].map((pid) => ({
        pid,
        startedAt: `start-${pid}`,
      })),
      tty: null,
      processReliable: true,
      reliable: true,
    }

    fake.emitExit(7)
    await vi.advanceTimersByTimeAsync(0)

    expect(record.live).toBeNull()
    expect(record.exitCode).toBe(7)
    expect(runtime.hasDetachedProcesses(record)).toBe(true)
    expect(shutdownDetachedProcess).toHaveBeenCalledOnce()
    expect(shutdownDetachedProcess.mock.calls[0]?.[0]).toMatchObject({
      live: { pty: fake.pty },
      processPids: [FAKE_PID, FAKE_PID + 1],
      processIdentities: [
        { pid: FAKE_PID, startedAt: `start-${FAKE_PID}` },
        { pid: FAKE_PID + 1, startedAt: `start-${FAKE_PID + 1}` },
      ],
    })
    expect(runtime.writeInput(record, 'too late')).toEqual({
      status: 'rejected',
      acceptedBytes: 0,
      reason: 'terminal-not-open',
    })
    expect(fake.write).not.toHaveBeenCalled()

    await expect(runtime.shutdownDetachedProcesses()).resolves.toBe(true)
    expect(shutdownDetachedProcess).toHaveBeenCalledTimes(2)
    expect(runtime.hasDetachedProcesses(record)).toBe(false)
  })

  it('shares one retained cleanup attempt between natural exit and concurrent close', async () => {
    const fake = makeFakePty(FAKE_PID)
    const cleanup = Promise.withResolvers<boolean>()
    const shutdownDetachedProcess = vi.fn(() => cleanup.promise)
    const { runtime } = makeRuntime(fake, 1, { shutdownDetachedProcess })
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows, 'shared-retained-cleanup')
    await vi.advanceTimersByTimeAsync(0)
    fake.emitExit(0)
    await vi.advanceTimersByTimeAsync(0)

    const close = runtime.killLive(record)
    await vi.advanceTimersByTimeAsync(0)
    expect(shutdownDetachedProcess).toHaveBeenCalledOnce()

    cleanup.resolve(true)
    await expect(close).resolves.toBe(true)
    expect(runtime.hasDetachedProcesses(record)).toBe(false)
    expect(shutdownDetachedProcess).toHaveBeenCalledOnce()
  })

  it('retains ownership when native resource drain fails after process-tree exit', async () => {
    const fake = makeFakePty(FAKE_PID)
    const shutdownDetachedProcess = vi.fn().mockResolvedValue(true)
    const { runtime } = makeRuntime(fake, 1, { shutdownDetachedProcess })
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows, 'failed-resource-drain')
    await vi.advanceTimersByTimeAsync(0)
    fake.emitProcessTreeExit(0)
    fake.rejectResourceDrain(new Error('native worker teardown failed'))
    fake.emitPublicExit(0)
    await vi.waitFor(() => expect(shutdownDetachedProcess).toHaveBeenCalledOnce())

    await expect(runtime.shutdownDetachedProcesses([record])).resolves.toBe(false)
    expect(record.live).toBeNull()
    expect(runtime.hasDetachedProcesses(record)).toBe(true)
  })

  it('retains and stops a spawned PTY when stream attachment fails', async () => {
    const fake = makeFakePty(FAKE_PID)
    Reflect.set(fake.pty, 'onData', () => {
      throw new Error('stream listener unavailable')
    })
    const shutdownDetachedProcess = vi.fn(async () => {
      fake.emitExit(0)
      return true
    })
    const { runtime } = makeRuntime(fake, 1, { shutdownDetachedProcess })
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows, 'failed-stream-attachment')
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(shutdownDetachedProcess).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(0)

    expect(record.live).toBeNull()
    expect(record.exitCode).toBe(-1)
    expect(runtime.hasDetachedProcesses(record)).toBe(false)
  })
})
