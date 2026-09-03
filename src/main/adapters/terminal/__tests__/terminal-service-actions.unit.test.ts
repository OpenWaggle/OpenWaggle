import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalEventPayload, TerminalOpenInput } from '@shared/types/terminal'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import type { IPty } from 'node-pty'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { TerminalEventSinkShape } from '../../../ports/terminal-event-sink'
import { makeNodePtyTerminalService } from '../../node-pty-terminal-service'
import type { PtyRunner, PtySpawnOutcome, PtySpawnRequest } from '../terminal-pty-runner'

const OWNER = 'session-1'
const TERMINAL_ID = 'main'
const TERMINAL_KEY = `${OWNER}::${TERMINAL_ID}`
const FAKE_PID = 4200

const OUTPUT_FLUSH_MS = TERMINAL.OUTPUT_FLUSH_MS
const HISTORY_FLUSH_MS = TERMINAL.HISTORY_FLUSH_MS

const runnerRef = vi.hoisted(() => {
  const ref: { current: PtyRunner | null } = { current: null }
  return ref
})

vi.mock('../terminal-pty-runner', () => ({
  makePtyRunner: () => {
    const runner = runnerRef.current
    if (runner === null) throw new Error('Fake PtyRunner was not configured for this test')
    return runner
  },
}))

interface FakePty {
  readonly pty: IPty
  readonly dataListeners: Array<(data: string) => void>
  readonly exitListeners: Array<(event: { readonly exitCode: number }) => void>
  readonly write: ReturnType<typeof vi.fn>
  readonly kill: ReturnType<typeof vi.fn>
}

function makeFakePty(pid: number): FakePty {
  const dataListeners: Array<(data: string) => void> = []
  const exitListeners: Array<(event: { readonly exitCode: number }) => void> = []
  const write = vi.fn()
  const kill = vi.fn()
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
  })
  return { pty, dataListeners, exitListeners, write, kill }
}

function makeRecordingSink() {
  const events: TerminalEventPayload[] = []
  const sink: TerminalEventSinkShape = {
    emit: (payload) =>
      Effect.sync(() => {
        events.push(payload)
      }),
    attach: () => Effect.void,
    detach: () => Effect.void,
    detachSurface: () => Effect.void,
  }
  return { events, sink }
}

type Service = ReturnType<typeof makeNodePtyTerminalService>

describe('makeNodePtyTerminalService', () => {
  let logsDir: string
  let workDirA: string
  let workDirB: string
  let service: Service
  let events: TerminalEventPayload[]
  let spawn: Mock<PtyRunner['spawn']>
  let ptys: FakePty[]
  let heldSpawns: Array<(outcome: PtySpawnOutcome) => void>
  let holdSpawns: boolean

  const openInput = (cwd: string): TerminalOpenInput => ({
    ownerKey: OWNER,
    terminalId: TERMINAL_ID,
    cwd,
    cols: 120,
    rows: 40,
  })

  const open = (cwd: string) => Effect.runPromise(service.open(openInput(cwd)))

  const settle = () => vi.advanceTimersByTimeAsync(0)

  const feed = (index: number, data: string) => ptys[index]?.dataListeners[0]?.(data)

  const expectEvent = (event: TerminalEventPayload['event']) =>
    expect(events).toContainEqual({ ownerKey: OWNER, terminalId: TERMINAL_ID, event })

  const logFileCount = async () => {
    const entries = await fs.readdir(logsDir)
    return entries.filter((entry) => entry.endsWith('.log')).length
  }

  beforeEach(async () => {
    logsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-service-logs-'))
    workDirA = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-service-a-'))
    workDirB = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-service-b-'))
    ptys = []
    heldSpawns = []
    holdSpawns = false
    spawn = vi.fn((_request: PtySpawnRequest): Promise<PtySpawnOutcome> => {
      const fake = makeFakePty(FAKE_PID + ptys.length)
      ptys.push(fake)
      if (holdSpawns) {
        return new Promise<PtySpawnOutcome>((resolve) => {
          heldSpawns.push(resolve)
        })
      }
      return Promise.resolve({ ok: true, pty: fake.pty, pid: fake.pty.pid })
    })
    const runner: PtyRunner = {
      spawn,
      load: () => new Promise<never>(() => undefined),
    }
    runnerRef.current = runner
    const { events: recorded, sink } = makeRecordingSink()
    events = recorded
    service = makeNodePtyTerminalService(sink, { logsDir })
    vi.useFakeTimers()
  })

  afterEach(async () => {
    vi.useRealTimers()
    runnerRef.current = null
    await service.dispose()
    await fs.rm(logsDir, { recursive: true, force: true })
    await fs.rm(workDirA, { recursive: true, force: true })
    await fs.rm(workDirB, { recursive: true, force: true })
  })

  it('creates a record and streams coalesced output with offsets on first open', async () => {
    const result = await open(workDirA)
    await settle()

    expect(result).toEqual({ history: '', outputBytes: 0, running: true })
    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn).toHaveBeenCalledWith({ cwd: workDirA, cols: 120, rows: 40 })
    expect(service.records.get(TERMINAL_KEY)?.cwd).toBe(workDirA)

    feed(0, 'hello')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)

    expectEvent({ type: 'output', data: 'hello', startOffset: 0, endOffset: 5 })
  })

  it('reuses the live shell for a second open with the same working path', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'hello')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)

    const result = await open(workDirA)

    expect(result).toEqual({ history: 'hello', outputBytes: 5, running: true })
    expect(spawn).toHaveBeenCalledOnce()
    expect(ptys[0]?.write).not.toHaveBeenCalled()
  })

  it('restarts the shell and resets scrollback when the working path changes', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'one')
    await vi.advanceTimersByTimeAsync(HISTORY_FLUSH_MS)

    const result = await open(workDirB)

    expect(result).toEqual({ history: '', outputBytes: 0, running: true })
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(ptys[0]?.kill).toHaveBeenCalledOnce()
    const record = service.records.get(TERMINAL_KEY)
    expect(record?.cwd).toBe(workDirB)
    expect(record?.scrollback.toString()).toBe('')
    expect(record?.outputBytes).toBe(0)
    await vi.waitFor(
      async () => {
        await expect(service.history.read(TERMINAL_KEY)).resolves.toBe('')
      },
      { timeout: 10_000 },
    )
  })

  it('respawns a dead shell in the same working path, replaying scrollback', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'hello')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)
    ptys[0]?.exitListeners[0]?.({ exitCode: 7 })
    expect(service.records.get(TERMINAL_KEY)?.live).toBeNull()

    const result = await open(workDirA)

    expect(result).toEqual({ history: 'hello', outputBytes: 5, running: true })
    expect(spawn).toHaveBeenCalledTimes(2)
    await settle()
    const record = service.records.get(TERMINAL_KEY)
    expect(record?.live?.pty).toBe(ptys[1]?.pty)
    expect(record?.exitCode).toBeNull()
  })

  it('reports cwd-missing without spawning when the working path is gone', async () => {
    const missing = path.join(workDirA, 'does-not-exist')

    const result = await open(missing)

    expect(result).toEqual({ history: '', outputBytes: 0, running: false, cwdMissing: true })
    expect(spawn).not.toHaveBeenCalled()
    expect(service.records.size).toBe(0)
  })

  it('coalesces concurrent opens for one terminal into a single spawn', async () => {
    holdSpawns = true
    const first = open(workDirA)
    const second = open(workDirA)

    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(firstResult).toEqual(secondResult)
    expect(spawn).toHaveBeenCalledOnce()
    const heldPty = ptys[0]?.pty
    if (heldPty === undefined) throw new Error('Expected a held fake pty')
    heldSpawns[0]?.({ ok: true, pty: heldPty, pid: heldPty.pid })
    await settle()
    expect(service.records.get(TERMINAL_KEY)?.live?.pty).toBe(heldPty)
  })

  it('restart resets the stream to zero bytes and spawns a fresh shell', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'before-restart')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)

    const result = await Effect.runPromise(service.restart(openInput(workDirA)))

    expect(result).toEqual({ history: '', outputBytes: 0, running: true })
    expect(spawn).toHaveBeenCalledTimes(2)
    const record = service.records.get(TERMINAL_KEY)
    expect(record?.scrollback.toString()).toBe('')
    expect(record?.outputBytes).toBe(0)
    await settle()
    expect(record?.live?.pty).toBe(ptys[1]?.pty)
  })

  it('clear resets offsets and history without writing to the shell stdin', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'clear me')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)
    expect(ptys[0]?.write).not.toHaveBeenCalled()

    await Effect.runPromise(service.clear(OWNER, TERMINAL_ID))

    const record = service.records.get(TERMINAL_KEY)
    expect(record?.scrollback.toString()).toBe('')
    expect(record?.outputBytes).toBe(0)
    expect(ptys[0]?.write).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenCalledOnce()
    expectEvent({ type: 'cleared' })
    await vi.waitFor(
      async () => {
        await expect(service.history.read(TERMINAL_KEY)).resolves.toBe('')
      },
      { timeout: 10_000 },
    )
  })

  it('close deletes history, emits closed, and late output cannot resurrect it', async () => {
    await open(workDirA)
    await settle()
    const record = service.records.get(TERMINAL_KEY)
    feed(0, 'persist me')
    await vi.advanceTimersByTimeAsync(HISTORY_FLUSH_MS)
    await vi.waitFor(async () => {
      expect(await logFileCount()).toBe(1)
    })

    await Effect.runPromise(service.close(OWNER, TERMINAL_ID, true))

    expect(ptys[0]?.kill).toHaveBeenCalledOnce()
    expect(service.records.has(TERMINAL_KEY)).toBe(false)
    expectEvent({ type: 'closed' })
    await vi.waitFor(async () => {
      expect(await logFileCount()).toBe(0)
    })

    const outputEventsBefore = events.filter((event) => event.event.type === 'output').length
    feed(0, 'late output after close')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)
    await service.history.flush()

    expect(record?.scrollback.toString()).toBe('persist me')
    expect(await logFileCount()).toBe(0)
    expect(events.filter((event) => event.event.type === 'output')).toHaveLength(outputEventsBefore)
  })

  it("closeAllForOwner kills and removes only that owner's terminals and history", async () => {
    await open(workDirA)
    const otherOwnerInput: TerminalOpenInput = {
      ownerKey: 'session-2',
      terminalId: TERMINAL_ID,
      cwd: workDirA,
      cols: 120,
      rows: 40,
    }
    await Effect.runPromise(service.open(otherOwnerInput))
    await settle()
    feed(0, 'owner a data')
    ptys[1]?.dataListeners[0]?.('owner b data')
    await vi.advanceTimersByTimeAsync(HISTORY_FLUSH_MS)
    await vi.waitFor(async () => {
      expect(await logFileCount()).toBe(2)
    })

    await Effect.runPromise(service.closeAllForOwner(OWNER, true))

    expect(service.records.has(TERMINAL_KEY)).toBe(false)
    expect(service.records.has(`session-2::${TERMINAL_ID}`)).toBe(true)
    expect(ptys[0]?.kill).toHaveBeenCalledOnce()
    expect(ptys[1]?.kill).not.toHaveBeenCalled()
    expect(events).toContainEqual({
      ownerKey: OWNER,
      terminalId: TERMINAL_ID,
      event: { type: 'closed' },
    })
    await vi.waitFor(async () => {
      expect(await logFileCount()).toBe(1)
    })
    await expect(service.history.read(TERMINAL_KEY)).resolves.toBe('')
    await expect(service.history.read(`session-2::${TERMINAL_ID}`)).resolves.toBe('owner b data')
  })
})
