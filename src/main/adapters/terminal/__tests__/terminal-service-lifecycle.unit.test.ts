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
const FAKE_PID = 4300
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

describe('terminal stream lifecycle', () => {
  let logsDir: string
  let workDirA: string
  let service: ReturnType<typeof makeNodePtyTerminalService>
  let events: TerminalEventPayload[]
  let spawn: Mock<PtyRunner['spawn']>
  let ptys: FakePty[]

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
    logsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-lifecycle-logs-'))
    workDirA = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-lifecycle-a-'))
    ptys = []
    spawn = vi.fn((_request: PtySpawnRequest): Promise<PtySpawnOutcome> => {
      const fake = makeFakePty(FAKE_PID + ptys.length)
      ptys.push(fake)
      return Promise.resolve({ ok: true, pty: fake.pty, pid: fake.pty.pid, shell: 'zsh' })
    })
    runnerRef.current = { spawn, load: () => new Promise<never>(() => undefined) }
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
  })

  it('close deletes history, emits closed, and late output cannot resurrect it', async () => {
    await open(workDirA)
    await settle()
    const record = service.records.get(TERMINAL_KEY)
    feed(0, 'persist me')
    await vi.advanceTimersByTimeAsync(HISTORY_FLUSH_MS)
    await vi.waitFor(
      async () => {
        expect(await logFileCount()).toBe(1)
      },
      { timeout: 10_000 },
    )

    await Effect.runPromise(service.close(OWNER, TERMINAL_ID, true))

    expect(ptys[0]?.kill).toHaveBeenCalledOnce()
    expect(service.records.has(TERMINAL_KEY)).toBe(false)
    expectEvent({ type: 'closed' })
    await vi.waitFor(
      async () => {
        expect(await logFileCount()).toBe(0)
      },
      { timeout: 10_000 },
    )

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
