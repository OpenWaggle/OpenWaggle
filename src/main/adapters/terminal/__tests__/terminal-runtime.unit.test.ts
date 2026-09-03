import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalEventPayload, TerminalOpenInput } from '@shared/types/terminal'
import { fromPartial } from '@total-typescript/shoehorn'
import type { IPty } from 'node-pty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTerminalHistoryStore } from '../terminal-history-store'
import type { PtyRunner, PtySpawnOutcome, PtySpawnRequest } from '../terminal-pty-runner'
import type { TerminalRuntime } from '../terminal-runtime'
import { makeTerminalRuntime } from '../terminal-runtime'

const ESC = '\x1b'
const FAKE_PID = 4242

const INPUT: TerminalOpenInput = {
  ownerKey: 'session-1',
  terminalId: 'main',
  cwd: '/worktrees/session-1',
  cols: 120,
  rows: 40,
}

interface FakePty {
  readonly pty: IPty
  readonly dataListeners: Array<(data: string) => void>
  readonly exitListeners: Array<(event: { readonly exitCode: number }) => void>
  readonly write: ReturnType<typeof vi.fn>
  readonly kill: ReturnType<typeof vi.fn>
  readonly resize: ReturnType<typeof vi.fn>
}

function makeFakePty(pid: number): FakePty {
  const dataListeners: Array<(data: string) => void> = []
  const exitListeners: Array<(event: { readonly exitCode: number }) => void> = []
  const write = vi.fn()
  const kill = vi.fn()
  const resize = vi.fn()
  const pty = fromPartial<IPty>({
    pid,
    onData: (listener: (data: string) => void) => {
      dataListeners.push(listener)
      return { dispose: () => undefined }
    },
    onExit: (listener: (event: { exitCode: number }) => void) => {
      exitListeners.push(listener)
      return { dispose: () => undefined }
    },
    write,
    kill,
    resize,
  })
  return { pty, dataListeners, exitListeners, write, kill, resize }
}

describe('makeTerminalRuntime', () => {
  let logsDir: string
  let store: ReturnType<typeof makeTerminalHistoryStore>

  function makeRuntime(pty: IPty) {
    const spawn = vi.fn(
      async (_request: PtySpawnRequest): Promise<PtySpawnOutcome> => ({
        ok: true,
        pty,
        pid: pty.pid,
      }),
    )
    const runner: PtyRunner = {
      spawn,
      load: () => Promise.resolve({ spawn: () => pty }),
    }
    const emit = vi.fn<(payload: TerminalEventPayload) => void>()
    const onLivePidsChanged = vi.fn()
    const runtime = makeTerminalRuntime({ runner, history: store, emit, onLivePidsChanged })
    return { runtime, spawn, emit, onLivePidsChanged }
  }

  function addRecord(runtime: TerminalRuntime) {
    const record = runtime.makeRecord(INPUT, INPUT.cwd)
    runtime.records.set(record.key, record)
    return record
  }

  beforeEach(async () => {
    logsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-runtime-'))
    store = makeTerminalHistoryStore(logsDir)
    vi.useFakeTimers()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await fs.rm(logsDir, { recursive: true, force: true })
  })

  it('builds a registry record from the open input', () => {
    const { runtime } = makeRuntime(makeFakePty(FAKE_PID).pty)

    const record = runtime.makeRecord(INPUT, INPUT.cwd)

    expect(record.key).toBe('session-1::main')
    expect(record.ownerKey).toBe('session-1')
    expect(record.terminalId).toBe('main')
    expect(record.cwd).toBe(INPUT.cwd)
    expect(record.live).toBeNull()
    expect(record.exitCode).toBeNull()
    expect(record.spawnGeneration).toBe(0)
    expect(record.pendingOutput).toBe('')
    expect(record.scrollback.toString()).toBe('')
  })

  it('coalesces output chunks into one emit after the flush window', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, emit, onLivePidsChanged } = makeRuntime(fake.pty)
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)

    expect(record.live).not.toBeNull()
    expect(onLivePidsChanged).toHaveBeenCalledOnce()

    fake.dataListeners[0]?.('hello')
    expect(record.pendingOutput).toBe('hello')
    expect(emit).not.toHaveBeenCalled()

    fake.dataListeners[0]?.(' world')
    expect(record.pendingOutput).toBe('hello world')

    await vi.advanceTimersByTimeAsync(TERMINAL.OUTPUT_FLUSH_MS)

    expect(emit).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith({
      ownerKey: 'session-1',
      terminalId: 'main',
      event: { type: 'output', data: 'hello world', startOffset: 0, endOffset: 11 },
    })
    expect(record.pendingOutput).toBe('')
    expect(record.scrollback.toString()).toBe('hello world')
  })

  it('appends sanitized output to scrollback and persisted history', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, emit } = makeRuntime(fake.pty)
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)

    fake.dataListeners[0]?.(`hidden${ESC}[6nvisible`)
    await vi.advanceTimersByTimeAsync(TERMINAL.OUTPUT_FLUSH_MS)

    expect(emit).toHaveBeenCalledWith({
      ownerKey: 'session-1',
      terminalId: 'main',
      event: {
        type: 'output',
        data: `hidden${ESC}[6nvisible`,
        startOffset: 0,
        endOffset: 17,
      },
    })
    expect(record.scrollback.toString()).toBe('hiddenvisible')

    await store.flush()
    await expect(store.read(record.key)).resolves.toBe('hiddenvisible')
  })

  it('emits the exit event on the current generation', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, emit, onLivePidsChanged } = makeRuntime(fake.pty)
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)

    fake.exitListeners[0]?.({ exitCode: 7 })

    expect(emit).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith({
      ownerKey: 'session-1',
      terminalId: 'main',
      event: { type: 'exited', exitCode: 7 },
    })
    expect(record.exitCode).toBe(7)
    expect(record.live).toBeNull()
    expect(onLivePidsChanged).toHaveBeenCalledTimes(2)
  })

  it('ignores a late exit after killLive bumps the generation', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, emit, onLivePidsChanged } = makeRuntime(fake.pty)
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)

    runtime.killLive(record)
    expect(fake.kill).toHaveBeenCalledOnce()
    expect(record.live).toBeNull()

    fake.exitListeners[0]?.({ exitCode: 0 })

    expect(emit).not.toHaveBeenCalled()
    expect(record.exitCode).toBeNull()
    expect(onLivePidsChanged).toHaveBeenCalledTimes(2)
  })

  it('drops pending output for a terminal via discardPendingOutput', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, emit } = makeRuntime(fake.pty)
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)

    fake.dataListeners[0]?.('buffered')
    runtime.discardPendingOutput(record.key)
    await vi.advanceTimersByTimeAsync(TERMINAL.OUTPUT_FLUSH_MS)

    expect(emit).not.toHaveBeenCalled()
  })

  it('emits a failed exit when the runner cannot spawn a shell', async () => {
    const fake = makeFakePty(FAKE_PID)
    const { runtime, spawn, emit } = makeRuntime(fake.pty)
    spawn.mockResolvedValue({ ok: false, error: new Error('no shell available') })
    const record = addRecord(runtime)

    runtime.spawn(record, INPUT.cols, INPUT.rows)
    await vi.advanceTimersByTimeAsync(0)

    expect(emit).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith({
      ownerKey: 'session-1',
      terminalId: 'main',
      event: { type: 'exited', exitCode: -1 },
    })
    expect(record.exitCode).toBe(-1)
    expect(record.live).toBeNull()
  })

  it('kills a stale spawn outcome when a newer generation wins', async () => {
    const first = makeFakePty(111)
    const second = makeFakePty(FAKE_PID)
    const { runtime, spawn } = makeRuntime(second.pty)
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

    expect(record.spawnGeneration).toBe(2)
    expect(record.live?.pty).toBe(second.pty)

    resolveFirst?.({ ok: true, pty: first.pty, pid: 111 })
    await vi.advanceTimersByTimeAsync(0)

    expect(first.kill).toHaveBeenCalledOnce()
    expect(record.live?.pty).toBe(second.pty)
  })
})
