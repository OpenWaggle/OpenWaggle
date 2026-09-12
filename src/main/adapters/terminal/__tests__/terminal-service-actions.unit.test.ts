import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  events,
  expectEvent,
  feed,
  heldSpawns,
  holdFutureSpawns,
  OUTPUT_FLUSH_MS,
  OWNER,
  open,
  openInput,
  ptys,
  service,
  settle,
  setupTerminalServiceActionsTest,
  spawn,
  successfulOutcome,
  TERMINAL_ID,
  TERMINAL_KEY,
  teardownTerminalServiceActionsTest,
  workDirA,
  workDirB,
} from './terminal-service-actions-test-harness'

describe('makeNodePtyTerminalService', () => {
  beforeEach(setupTerminalServiceActionsTest)
  afterEach(teardownTerminalServiceActionsTest)

  it('creates a record and streams coalesced output with offsets on first open', async () => {
    const result = await open(workDirA)
    await settle()

    expect(result).toEqual({
      inputIncarnation: service.records.get(TERMINAL_KEY)?.inputIncarnation,
      history: '',
      outputBytes: 0,
      outputGeneration: 1,
      readiness: { phase: 'spawning', generation: 1 },
      pendingInputBytes: 0,
      running: true,
      processName: null,
      ports: [],
      projectActionPending: false,
    })
    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn).toHaveBeenCalledWith({
      cwd: workDirA,
      cols: 120,
      rows: 40,
      env: {},
      readinessNonce: expect.any(String),
    })
    expect(service.records.get(TERMINAL_KEY)?.cwd).toBe(workDirA)

    feed(0, 'hello')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)

    expectEvent({
      type: 'output',
      data: 'hello',
      outputGeneration: 1,
      startOffset: 0,
      endOffset: 5,
    })
  })

  it('reuses the live shell for a second open with the same working path', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'hello')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)

    const result = await open(workDirA)

    expect(result).toEqual({
      inputIncarnation: service.records.get(TERMINAL_KEY)?.inputIncarnation,
      history: 'hello',
      outputBytes: 5,
      outputGeneration: 1,
      readiness: { phase: 'awaiting-prompt', generation: 1 },
      pendingInputBytes: 0,
      running: true,
      processName: null,
      ports: [],
      projectActionPending: false,
    })
    expect(spawn).toHaveBeenCalledOnce()
    expect(ptys[0]?.write).not.toHaveBeenCalled()
  })

  it('reconciles an unacknowledged chunk covered by a replacement attach snapshot', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'before reload')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)
    expect(service.records.get(TERMINAL_KEY)?.inFlightOutput).not.toBeNull()

    const replacement = await open(workDirA)
    expect(replacement.history).toBe('before reload')
    expect(service.records.get(TERMINAL_KEY)?.inFlightOutput).toBeNull()

    feed(0, ' after reload')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)
    expect(events).toContainEqual({
      ownerKey: OWNER,
      terminalId: TERMINAL_ID,
      event: {
        type: 'output',
        data: ' after reload',
        outputGeneration: replacement.outputGeneration,
        startOffset: 13,
        endOffset: 26,
      },
    })
  })

  it('keeps action overrides when a same-cwd pane attach omits env', async () => {
    const env = {
      OPENWAGGLE_PROJECT_ROOT: '/project',
      T3CODE_PROJECT_ROOT: '/project',
    }
    await Effect.runPromise(service.open({ ...openInput(workDirA), env }))
    await settle()

    await open(workDirA)

    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn.mock.calls[0]?.[0].env).toEqual(env)
    expect(service.records.get(TERMINAL_KEY)?.env).toEqual(env)
  })

  it('restarts and clears history when an explicit environment context changes', async () => {
    await Effect.runPromise(
      service.open({ ...openInput(workDirA), env: { ACTION_CONTEXT: 'first' } }),
    )
    await settle()
    feed(0, 'old output')
    await vi.advanceTimersByTimeAsync(OUTPUT_FLUSH_MS)

    await Effect.runPromise(
      service.open({ ...openInput(workDirA), env: { ACTION_CONTEXT: 'second' } }),
    )

    expect(spawn).toHaveBeenCalledTimes(2)
    expect(ptys[0]?.closeDescriptor).toHaveBeenCalledOnce()
    expect(ptys[0]?.kill).not.toHaveBeenCalled()
    expect(spawn.mock.calls[1]?.[0].env).toEqual({ ACTION_CONTEXT: 'second' })
    expect(service.records.get(TERMINAL_KEY)?.scrollback.toString()).toBe('')
  })

  it('restarts the shell and resets scrollback when the working path changes', async () => {
    await open(workDirA)
    await settle()
    feed(0, 'one')
    await service.history.flush()

    const result = await open(workDirB)

    expect(result).toMatchObject({
      history: '',
      outputBytes: 0,
      outputGeneration: 2,
      running: true,
    })
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(ptys[0]?.closeDescriptor).toHaveBeenCalledOnce()
    expect(ptys[0]?.kill).not.toHaveBeenCalled()
    const record = service.records.get(TERMINAL_KEY)
    expect(record?.cwd).toBe(workDirB)
    expect(record?.scrollback.toString()).toBe('')
    expect(record?.outputBytes).toBe(0)
    // Truncate is enqueued on the key's write chain; flush is the barrier.
    await service.history.flush()
    await expect(service.history.read(TERMINAL_KEY)).resolves.toBe('')
  })

  it('coalesces concurrent opens for one terminal into a single spawn', async () => {
    holdFutureSpawns()
    const first = open(workDirA)
    const second = open(workDirA)

    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(firstResult).toEqual(secondResult)
    expect(spawn).toHaveBeenCalledOnce()
    const held = ptys[0]
    if (held === undefined) throw new Error('Expected a held fake pty')
    heldSpawns[0]?.(successfulOutcome(held))
    await settle()
    expect(service.records.get(TERMINAL_KEY)?.live?.pty).toBe(held.pty)
  })

  it('applies a later renderer nonce while a same-context shell is still spawning', async () => {
    holdFutureSpawns()
    const first = Effect.runPromise(
      service.open({ ...openInput(workDirA), inputGeneration: 'renderer-a' }),
    )
    const second = Effect.runPromise(
      service.open({ ...openInput(workDirA), inputGeneration: 'renderer-b' }),
    )

    await Promise.all([first, second])

    expect(spawn).toHaveBeenCalledOnce()
    expect(service.records.get(TERMINAL_KEY)?.inputGeneration).toBe('renderer-b')
    const held = ptys[0]
    if (held === undefined) throw new Error('Expected a held fake PTY')
    heldSpawns[0]?.(successfulOutcome(held))
    await settle()
  })

  it('does not collapse a later launch context into an overlapping open', async () => {
    holdFutureSpawns()
    const first = Effect.runPromise(
      service.open({ ...openInput(workDirA), env: { ACTION_CONTEXT: 'first' } }),
    )
    const second = Effect.runPromise(
      service.open({ ...openInput(workDirB), env: { ACTION_CONTEXT: 'second' } }),
    )

    await first
    const initial = ptys[0]
    if (initial === undefined) throw new Error('Expected the first held fake PTY')
    heldSpawns[0]?.(successfulOutcome(initial))
    await second

    expect(spawn).toHaveBeenCalledTimes(2)
    expect(service.records.get(TERMINAL_KEY)).toMatchObject({
      cwd: workDirB,
      env: { ACTION_CONTEXT: 'second' },
    })
    const replacement = ptys[1]
    if (replacement === undefined) throw new Error('Expected the replacement held fake PTY')
    heldSpawns[1]?.(successfulOutcome(replacement))
    await settle()
  })

  it('waits for an in-flight spawn and confirms its exit before close removes the record', async () => {
    holdFutureSpawns()
    await open(workDirA)
    const spawned = ptys[0]
    if (spawned === undefined) throw new Error('Expected a held fake PTY')

    const closing = Effect.runPromise(service.close(OWNER, TERMINAL_ID, false))
    await vi.advanceTimersByTimeAsync(0)
    expect(service.records.has(TERMINAL_KEY)).toBe(true)
    expect(spawned.closeDescriptor).not.toHaveBeenCalled()
    expect(events.some((payload) => payload.event.type === 'closed')).toBe(false)

    heldSpawns[0]?.(successfulOutcome(spawned))
    await closing

    expect(spawned.closeDescriptor).toHaveBeenCalledOnce()
    expect(spawned.kill).not.toHaveBeenCalled()
    expect(service.records.has(TERMINAL_KEY)).toBe(false)
    expectEvent({ type: 'closed' })
  })

  it('orders close behind an open waiting on persisted history without orphaning a PTY', async () => {
    let finishRead: ((history: string) => void) | undefined
    let reportReadStarted: (() => void) | undefined
    const readStarted = new Promise<void>((resolve) => {
      reportReadStarted = resolve
    })
    service.history.read = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishRead = resolve
          reportReadStarted?.()
        }),
    )

    const opening = open(workDirA)
    await readStarted
    const closing = Effect.runPromise(service.close(OWNER, TERMINAL_ID, false))
    await vi.advanceTimersByTimeAsync(0)

    expect(spawn).not.toHaveBeenCalled()
    expect(service.records.size).toBe(0)

    finishRead?.('')
    await opening
    await settle()
    await closing

    expect(spawn).toHaveBeenCalledOnce()
    expect(ptys[0]?.closeDescriptor).toHaveBeenCalledOnce()
    expect(ptys[0]?.kill).not.toHaveBeenCalled()
    expect(service.records.size).toBe(0)
    expectEvent({ type: 'closed' })
  })

  it('orders restart behind an open waiting on history and leaves one reachable shell', async () => {
    let finishRead: ((history: string) => void) | undefined
    let reportReadStarted: (() => void) | undefined
    const readStarted = new Promise<void>((resolve) => {
      reportReadStarted = resolve
    })
    service.history.read = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishRead = resolve
          reportReadStarted?.()
        }),
    )

    const opening = open(workDirA)
    await readStarted
    const restarting = Effect.runPromise(service.restart(openInput(workDirA)))
    finishRead?.('')

    await opening
    await settle()
    await restarting
    await settle()

    expect(spawn).toHaveBeenCalledTimes(2)
    expect(ptys[0]?.closeDescriptor).toHaveBeenCalledOnce()
    expect(ptys[0]?.kill).not.toHaveBeenCalled()
    expect(ptys[1]?.closeDescriptor).not.toHaveBeenCalled()
    expect(service.records.size).toBe(1)
    expect(service.records.get(TERMINAL_KEY)?.live?.pty).toBe(ptys[1]?.pty)
  })
})
