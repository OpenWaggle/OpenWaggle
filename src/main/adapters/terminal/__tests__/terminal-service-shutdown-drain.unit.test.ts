import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessRow } from '../terminal-process-inspector'
import {
  feed,
  open,
  OWNER,
  ptys,
  service,
  settle,
  setupTerminalServiceActionsTest,
  teardownTerminalServiceActionsTest,
  TERMINAL_KEY,
  workDirA,
} from './terminal-service-actions-test-harness'
import { terminalKeys } from './terminal-service-observations'

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

function processRow(pid: number, ppid: number, name: string) {
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
  } satisfies ProcessRow
}

describe('makeNodePtyTerminalService owner and app shutdown drain', () => {
  beforeEach(async () => {
    processProbe.rows = new Map([
      [4_200, processRow(4_200, 1, 'zsh')],
      [4_201, processRow(4_201, 1, 'zsh')],
    ])
    await setupTerminalServiceActionsTest()
  })
  afterEach(teardownTerminalServiceActionsTest)

  it('lets destructive owner cleanup proceed after tree proof without waiting for PTY drain', async () => {
    await open(workDirA)
    await settle()
    const first = ptys[0]
    const record = service.records.get(TERMINAL_KEY)
    if (first === undefined || record === undefined) throw new Error('Expected live terminal')
    first.closeDescriptor.mockImplementationOnce(() => undefined)

    const closing = Effect.runPromise(service.closeAllForOwner(OWNER, false))
    await vi.waitFor(() => expect(first.closeDescriptor).toHaveBeenCalledOnce())
    first.emitProcessTreeExit(0)
    await closing

    expect(await terminalKeys()).not.toContain(TERMINAL_KEY)
    expect(record.closed).toBe(true)
    feed(0, 'discarded after destructive close')
    expect(record.scrollback.toString()).toBe('')

    first.resolveResourceDrain()
    first.emitPublicExit(0)
    await settle()
  })

  it('keeps app shutdown pending until both native resources and final output exit drain', async () => {
    await open(workDirA)
    await settle()
    const first = ptys[0]
    const record = service.records.get(TERMINAL_KEY)
    if (first === undefined || record === undefined) throw new Error('Expected live terminal')
    first.closeDescriptor.mockImplementationOnce(() => undefined)

    let settled = false
    const closing = Effect.runPromise(service.closeAll()).then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(first.closeDescriptor).toHaveBeenCalledOnce())
    first.emitProcessTreeExit(0)
    await vi.waitFor(() => expect(record.live).toBeNull())
    expect(settled).toBe(false)

    first.resolveResourceDrain()
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)

    first.emitPublicExit(0)
    await closing
    expect(settled).toBe(true)
    expect(await terminalKeys()).not.toContain(TERMINAL_KEY)
  })
})
