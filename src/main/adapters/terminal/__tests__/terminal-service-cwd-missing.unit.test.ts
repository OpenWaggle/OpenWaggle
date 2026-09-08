import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { coldTerminalReplay } from '../terminal-replay'
import {
  feed,
  open,
  ptys,
  service,
  settle,
  setupTerminalServiceActionsTest,
  spawn,
  TERMINAL_KEY,
  teardownTerminalServiceActionsTest,
  workDirA,
} from './terminal-service-actions-test-harness'

describe('makeNodePtyTerminalService cwd validation', () => {
  beforeEach(setupTerminalServiceActionsTest)
  afterEach(teardownTerminalServiceActionsTest)

  it('reports cwd-missing without spawning when the working path is gone', async () => {
    const missing = path.join(workDirA, 'does-not-exist')

    const result = await open(missing)

    expect(result).toEqual({
      history: '',
      outputBytes: 0,
      outputGeneration: 0,
      readiness: null,
      pendingInputBytes: 0,
      running: false,
      cwdMissing: true,
      processName: null,
      ports: [],
      projectActionPending: false,
    })
    expect(spawn).not.toHaveBeenCalled()
    expect(service.records.size).toBe(0)
  })

  it('stops an existing shell before reporting that its replacement cwd is missing', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'retained output')
    const missing = path.join(workDirA, 'removed-after-open')

    const result = await open(missing)

    expect(result).toMatchObject({
      history: coldTerminalReplay('retained output'),
      running: false,
      cwdMissing: true,
    })
    expect(ptys[0]?.closeDescriptor).toHaveBeenCalledOnce()
    expect(ptys[0]?.kill).not.toHaveBeenCalled()
    expect(service.records.get(TERMINAL_KEY)?.live).toBeNull()
    expect(spawn).toHaveBeenCalledOnce()
  })

  it('includes final buffered output after draining a shell replaced by a missing cwd', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'before shutdown')
    const first = ptys[0]
    if (first === undefined) throw new Error('Expected first PTY')
    first.closeDescriptor.mockImplementationOnce(() => undefined)
    const missing = path.join(workDirA, 'missing-after-tree-exit')

    const opening = service
      .open({
        ownerKey: 'session-1',
        terminalId: 'main',
        cwd: missing,
        cols: 120,
        rows: 40,
      })
      .pipe(Effect.runPromise)
    await vi.waitFor(() => expect(first.closeDescriptor).toHaveBeenCalledOnce())
    first.emitProcessTreeExit(0)
    await vi.waitFor(() => expect(service.records.get(TERMINAL_KEY)?.live).toBeNull())
    feed(0, ' and final output')
    first.resolveResourceDrain()
    first.emitPublicExit(0)

    await expect(opening).resolves.toMatchObject({
      history: coldTerminalReplay('before shutdown and final output'),
      running: false,
      cwdMissing: true,
    })
  })

  it('does not leave the previous shell running behind a failed explicit restart', async () => {
    await open(workDirA)
    await settle()
    const missing = path.join(workDirA, 'missing-restart-target')

    const result = await service
      .restart({
        ownerKey: 'session-1',
        terminalId: 'main',
        cwd: missing,
        cols: 120,
        rows: 40,
      })
      .pipe(Effect.runPromise)

    expect(result).toMatchObject({ running: false, cwdMissing: true })
    expect(ptys[0]?.closeDescriptor).toHaveBeenCalledOnce()
    expect(ptys[0]?.kill).not.toHaveBeenCalled()
    expect(service.records.get(TERMINAL_KEY)?.live).toBeNull()
    expect(spawn).toHaveBeenCalledOnce()
  })

  it('returns sanitized persisted replay when a cold terminal working path is gone', async () => {
    const missing = path.join(workDirA, 'removed-worktree')
    const persisted = 'before\x1b[?1049hhidden\x1b[?2004hafter'
    service.history.append(TERMINAL_KEY, persisted)
    await service.history.flush()

    const result = await open(missing)

    expect(result).toMatchObject({
      history: coldTerminalReplay('beforehiddenafter'),
      running: false,
      cwdMissing: true,
    })
    expect(result.history).not.toContain('\x1b[?1049h')
    expect(spawn).not.toHaveBeenCalled()
  })
})
