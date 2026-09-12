import { TERMINAL } from '@shared/constants/resource-limits'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessRow } from '../terminal-process-inspector'
import {
  TERMINAL_GRACEFUL_SHUTDOWN_MS,
  TERMINAL_SHUTDOWN_PIPELINE_MS,
} from '../terminal-process-shutdown'
import {
  events,
  expectEvent,
  feed,
  logFileCount,
  OUTPUT_FLUSH_MS,
  OWNER,
  open,
  openInput,
  ptys,
  service,
  settle,
  setupTerminalServiceActionsTest,
  TERMINAL_ID,
  TERMINAL_KEY,
  teardownTerminalServiceActionsTest,
  workDirA,
} from './terminal-service-actions-test-harness'

const processProbe = vi.hoisted(() => ({
  rows: new Map<number, ProcessRow>(),
}))

vi.mock('../terminal-process-probes', () => ({
  NO_TTY_FOREGROUND_GROUP: -1,
  parsePosixRow: vi.fn(),
  readListeningPorts: vi.fn(() => Promise.resolve(new Map())),
  readProcessMetadata: vi.fn((pid: number) =>
    Promise.resolve({ pid, startedAt: `start-${pid}`, tty: null, ttyIdentity: null }),
  ),
  readProcessTable: vi.fn(() => Promise.resolve(new Map(processProbe.rows))),
  readProcessTty: vi.fn(() => Promise.resolve(null)),
}))

function processRow(pid: number, ppid: number, name: string): ProcessRow {
  return {
    pid,
    ppid,
    pgid: pid,
    tpgid: pid,
    tty: null,
    ttyIdentity: null,
    identityVerified: true,
    zombie: false,
    startedAt: `start-${pid}`,
    name,
  }
}

describe('makeNodePtyTerminalService close history lifecycle', () => {
  beforeEach(async () => {
    processProbe.rows = new Map([
      [4_200, processRow(4_200, 1, 'zsh')],
      [4_201, processRow(4_201, 1, 'zsh')],
    ])
    await setupTerminalServiceActionsTest()
  })
  afterEach(teardownTerminalServiceActionsTest)

  it('deletes history, emits closed, and ignores output arriving after close', async () => {
    await open(workDirA)
    await settle()
    const record = service.records.get(TERMINAL_KEY)
    feed(0, 'persist me')
    await vi.advanceTimersByTimeAsync(TERMINAL.HISTORY_FLUSH_MS)
    await vi.waitFor(async () => {
      expect(await logFileCount()).toBe(1)
    })

    await Effect.runPromise(service.close(OWNER, TERMINAL_ID, true))

    expect(ptys[0]?.closeDescriptor).toHaveBeenCalledOnce()
    expect(ptys[0]?.kill).not.toHaveBeenCalled()
    expect(service.records.has(TERMINAL_KEY)).toBe(false)
    expect(record?.pendingOutput).toBe('')
    expect(record?.pendingOutputBytes).toBe(0)
    expect(record?.inFlightOutput).toBeNull()
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

  it('keeps renderer-visible state until graceful PTY exit is confirmed', async () => {
    await open(workDirA)
    await settle()
    const first = ptys[0]
    if (first === undefined) throw new Error('Expected first PTY')
    first.closeDescriptor.mockImplementationOnce(() => undefined)

    const closing = Effect.runPromise(service.close(OWNER, TERMINAL_ID, true))
    await vi.advanceTimersByTimeAsync(TERMINAL_GRACEFUL_SHUTDOWN_MS - 1)

    expect(first.closeDescriptor).toHaveBeenCalledOnce()
    expect(service.records.has(TERMINAL_KEY)).toBe(true)
    expect(service.records.get(TERMINAL_KEY)?.termination?.pty).toBe(first.pty)
    expect(events.some((payload) => payload.event.type === 'closed')).toBe(false)

    first.emitExit(0)
    await closing
    expect(service.records.has(TERMINAL_KEY)).toBe(false)
    expectEvent({ type: 'closed' })
  })

  it('retains final output and waits for resource plus public-exit drain after tree exit', async () => {
    await open(workDirA)
    await settle()
    const first = ptys[0]
    const record = service.records.get(TERMINAL_KEY)
    if (first === undefined || record === undefined) throw new Error('Expected live terminal')
    first.closeDescriptor.mockImplementationOnce(() => undefined)

    let settled = false
    const closing = Effect.runPromise(service.close(OWNER, TERMINAL_ID, false)).then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(first.closeDescriptor).toHaveBeenCalledOnce())

    first.emitProcessTreeExit(0)
    await vi.waitFor(() => expect(record.live).toBeNull())
    expect(first.pauseOutput).toHaveBeenCalledOnce()
    expect(first.resumeOutput).toHaveBeenCalledTimes(2)
    feed(0, 'final buffered output')
    expect(record.scrollback.toString()).toBe('final buffered output')
    expect(settled).toBe(false)

    first.resolveResourceDrain()
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)

    first.emitPublicExit(0)
    await closing
    expect(service.records.has(TERMINAL_KEY)).toBe(false)
    await expect(service.history.read(TERMINAL_KEY)).resolves.toBe('final buffered output')
  })

  it('force-escalates a process tree after the bounded graceful window', async () => {
    await open(workDirA)
    await settle()
    const first = ptys[0]
    if (first === undefined) throw new Error('Expected first PTY')
    first.closeDescriptor
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => first.emitExit(137))

    const closing = Effect.runPromise(service.close(OWNER, TERMINAL_ID, false))
    await vi.advanceTimersByTimeAsync(TERMINAL_GRACEFUL_SHUTDOWN_MS - 1)
    expect(first.closeDescriptor).toHaveBeenCalledOnce()
    expect(service.records.has(TERMINAL_KEY)).toBe(true)

    await vi.advanceTimersByTimeAsync(1)
    first.emitExit(137)
    await closing
    expect(first.closeDescriptor).toHaveBeenCalledOnce()
    expect(first.kill).not.toHaveBeenCalled()
    expect(service.records.has(TERMINAL_KEY)).toBe(false)
    expectEvent({ type: 'closed' })
  })

  it('never turns inspected descendants into raw numeric process signals', async () => {
    await open(workDirA)
    await settle()
    const first = ptys[0]
    const record = service.records.get(TERMINAL_KEY)
    if (first === undefined || record === undefined) throw new Error('Expected live terminal')
    const childPids = [first.pty.pid + 10, first.pty.pid + 11]
    processProbe.rows = new Map([
      [first.pty.pid, processRow(first.pty.pid, 1, 'zsh')],
      [childPids[0] ?? 0, processRow(childPids[0] ?? 0, first.pty.pid, 'node')],
      [childPids[1] ?? 0, processRow(childPids[1] ?? 0, first.pty.pid, 'vite')],
    ])
    record.activity = {
      processName: 'node',
      processNames: ['node', 'vite'],
      ports: [5173],
      processPids: [first.pty.pid, ...childPids],
      processIdentities: [first.pty.pid, ...childPids].map((pid) => ({
        pid,
        startedAt: `start-${pid}`,
      })),
      tty: null,
      processReliable: true,
      reliable: true,
    }
    let descriptorClosed = false
    first.closeDescriptor.mockImplementation(() => {
      descriptorClosed = true
      first.emitExit(0)
    })
    const processKill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (typeof pid !== 'number') return true
      if (signal === 0 && descriptorClosed) {
        const error = new Error('gone')
        Object.assign(error, { code: 'ESRCH' })
        throw error
      }
      return true
    })

    try {
      await Effect.runPromise(service.close(OWNER, TERMINAL_ID, false))
      for (const pid of childPids) {
        expect(processKill).not.toHaveBeenCalledWith(pid, 'SIGKILL')
      }
      expect(first.closeDescriptor).toHaveBeenCalledOnce()
      expect(first.kill).not.toHaveBeenCalled()
    } finally {
      processKill.mockRestore()
    }
  })

  it("closeAllForOwner removes only that owner's terminals and history", async () => {
    await open(workDirA)
    const otherOwnerInput = { ...openInput(workDirA), ownerKey: 'session-2' }
    await Effect.runPromise(service.open(otherOwnerInput))
    await settle()
    feed(0, 'owner a data')
    ptys[1]?.dataListeners[0]?.('owner b data')
    await vi.advanceTimersByTimeAsync(TERMINAL.HISTORY_FLUSH_MS)
    await vi.waitFor(async () => {
      expect(await logFileCount()).toBe(2)
    })

    await Effect.runPromise(service.closeAllForOwner(OWNER, true))

    expect(service.records.has(TERMINAL_KEY)).toBe(false)
    expect(service.records.has(`session-2::${TERMINAL_ID}`)).toBe(true)
    expect(ptys[0]?.closeDescriptor).toHaveBeenCalledOnce()
    expect(ptys[1]?.closeDescriptor).not.toHaveBeenCalled()
    expectEvent({ type: 'closed' })
    await vi.waitFor(async () => {
      expect(await logFileCount()).toBe(1)
    })
    await expect(service.history.read(TERMINAL_KEY)).resolves.toBe('')
    await expect(service.history.read(`session-2::${TERMINAL_ID}`)).resolves.toBe('owner b data')
  })

  it('attempts every terminal when one app-shutdown close cannot be confirmed', async () => {
    await open(workDirA)
    const secondKey = `session-2::${TERMINAL_ID}`
    await Effect.runPromise(service.open({ ...openInput(workDirA), ownerKey: 'session-2' }))
    await settle()
    const first = ptys[0]
    const second = ptys[1]
    if (first === undefined || second === undefined) throw new Error('Expected two terminals')
    first.closeDescriptor.mockImplementation(() => undefined)
    const processKill = vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === first.pty.pid) return true
      return true
    })

    try {
      const closing = Effect.runPromise(service.closeAll()).catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(TERMINAL_SHUTDOWN_PIPELINE_MS)

      await expect(closing).resolves.toEqual(
        expect.objectContaining({ message: 'Terminal shutdown did not complete.' }),
      )
      expect(first.closeDescriptor).toHaveBeenCalled()
      expect(second.closeDescriptor).toHaveBeenCalled()
      expect(first.kill).not.toHaveBeenCalled()
      expect(second.kill).not.toHaveBeenCalled()
      expect(service.records.has(TERMINAL_KEY)).toBe(true)
      expect(service.records.has(secondKey)).toBe(false)
    } finally {
      processKill.mockRestore()
    }

    // Leave teardown with a closable live fake after exercising fail-closed.
    first.closeDescriptor.mockImplementation(() => first.emitExit(0))
    first.emitExit(0)
    await settle()
  })

  it('keeps the record addressable and emits no close when history deletion fails', async () => {
    await open(workDirA)
    await settle()
    const failure = new Error('history deletion denied')
    service.history.remove = vi.fn(() => Promise.reject(failure))

    await expect(Effect.runPromise(service.close(OWNER, TERMINAL_ID, true))).rejects.toThrow(
      failure.message,
    )

    expect(ptys[0]?.closeDescriptor).toHaveBeenCalledOnce()
    expect(service.records.has(TERMINAL_KEY)).toBe(true)
    expect(events.some((payload) => payload.event.type === 'closed')).toBe(false)
  })
})
