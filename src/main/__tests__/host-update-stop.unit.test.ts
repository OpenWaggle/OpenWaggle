import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const { electronApp } = vi.hoisted(() => {
  const electronApp: {
    emitter: import('node:events').EventEmitter | null
    readonly exit: ReturnType<typeof vi.fn>
  } = { emitter: null, exit: vi.fn() }
  return { electronApp }
})
vi.mock('electron', () => ({
  app: {
    once: (event: string, listener: () => void) => electronApp.emitter?.once(event, listener),
    off: (event: string, listener: () => void) => electronApp.emitter?.off(event, listener),
    exit: electronApp.exit,
  },
}))

const { cancelUpdateOnInterrupt, stopSessionHostForUpdate } = await import('../host-update-stop')
type HostUpdateStopDependencies = import('../host-update-stop').HostUpdateStopDependencies
type UpdateRunChoice = import('../host-update-stop').UpdateRunChoice

function dependencies(input: {
  readonly runCounts: readonly (number | null)[]
  readonly choice?: UpdateRunChoice
  readonly desktopOpen?: boolean | readonly boolean[]
}) {
  const counts = [...input.runCounts]
  const desktop = typeof input.desktopOpen === 'object' ? [...input.desktopOpen] : []
  const progress: string[] = []
  const value = {
    desktopAppRunning: vi.fn(() => {
      const open = input.desktopOpen ?? false
      return typeof open === 'boolean' ? open : (desktop.shift() ?? false)
    }),
    countActiveRuns: vi.fn(async () =>
      counts.length > 1 ? (counts.shift() ?? null) : (counts[0] ?? null),
    ),
    chooseRunHandling: vi.fn(async () => input.choice ?? 'when-idle'),
    release: vi.fn<HostUpdateStopDependencies['release']>(async () => 'stopped'),
    progress: (text: string) => {
      progress.push(text)
    },
    wait: vi.fn(async () => undefined),
  } satisfies HostUpdateStopDependencies
  return { value, progress }
}

describe('stopping the Session Host for an update from the CLI', () => {
  it('stops an idle Host without asking', async () => {
    const { value } = dependencies({ runCounts: [0] })

    await expect(stopSessionHostForUpdate(value)).resolves.toEqual({
      state: 'stopped',
      activeRuns: 0,
    })
    expect(value.chooseRunHandling).not.toHaveBeenCalled()
    expect(value.release).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no Host is running, and never starts one', async () => {
    const { value } = dependencies({ runCounts: [null] })

    await expect(stopSessionHostForUpdate(value)).resolves.toMatchObject({ state: 'not-running' })
    expect(value.release).not.toHaveBeenCalled()
  })

  it('leaves the Host to the desktop app while it is open', async () => {
    const { value } = dependencies({ runCounts: [2], desktopOpen: true })

    await expect(stopSessionHostForUpdate(value)).resolves.toMatchObject({ state: 'desktop-open' })
    expect(value.countActiveRuns).not.toHaveBeenCalled()
    expect(value.release).not.toHaveBeenCalled()
  })

  it('waits for active Runs, including ones started meanwhile, then stops the Host', async () => {
    const { value, progress } = dependencies({ runCounts: [2, 2, 1, 0] })

    await expect(stopSessionHostForUpdate(value)).resolves.toEqual({
      state: 'stopped',
      activeRuns: 2,
    })
    expect(value.chooseRunHandling).toHaveBeenCalledWith(2)
    expect(progress).toEqual([
      'Waiting for 2 agent runs to finish…',
      'Waiting for 1 agent run to finish…',
    ])
    expect(value.release).toHaveBeenCalledTimes(1)
  })

  it('stops at once when asked, leaving the Host to interrupt Runs at its deadline', async () => {
    const { value } = dependencies({ runCounts: [1], choice: 'now' })

    await expect(stopSessionHostForUpdate(value)).resolves.toMatchObject({ state: 'stopped' })
    expect(value.wait).not.toHaveBeenCalled()
    expect(value.release).toHaveBeenCalledTimes(1)
  })

  it('cancels without touching the Host', async () => {
    const { value } = dependencies({ runCounts: [1], choice: 'cancel' })

    await expect(stopSessionHostForUpdate(value)).resolves.toEqual({
      state: 'cancelled',
      activeRuns: 1,
    })
    expect(value.release).not.toHaveBeenCalled()
  })

  it('reports a Host that exits while it waits for Runs', async () => {
    const { value } = dependencies({ runCounts: [1, null] })

    await expect(stopSessionHostForUpdate(value)).resolves.toMatchObject({ state: 'not-running' })
    expect(value.release).not.toHaveBeenCalled()
  })

  it('stops again once when another client restarted the Host meanwhile', async () => {
    const { value } = dependencies({ runCounts: [0] })
    value.release.mockResolvedValueOnce('replaced').mockResolvedValueOnce('stopped')

    await expect(stopSessionHostForUpdate(value)).resolves.toMatchObject({ state: 'stopped' })
    expect(value.release).toHaveBeenCalledTimes(2)
  })

  it('leaves the Host alone when the app was opened while it waited for Runs', async () => {
    const { value } = dependencies({ runCounts: [1, 0], desktopOpen: [false, true] })

    await expect(stopSessionHostForUpdate(value)).resolves.toEqual({
      state: 'desktop-open',
      activeRuns: 1,
    })
    expect(value.release).not.toHaveBeenCalled()
  })

  it('cancels with status 130 when Ctrl-C quits the CLI while the Host stops', async () => {
    const emitter = new EventEmitter()
    electronApp.emitter = emitter
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    let finish: () => void = () => undefined
    const stopping = cancelUpdateOnInterrupt(
      () => new Promise<void>((resolve) => (finish = resolve)),
    )
    emitter.emit('before-quit')
    finish()
    await stopping

    expect(electronApp.exit).toHaveBeenCalledWith(130)
    expect(process.stderr.write).toHaveBeenCalledWith(
      '\nUpdate cancelled. OpenWaggle was not changed.\n',
    )
  })

  it('lets a later quit, such as the installer quit, proceed once the Host has stopped', async () => {
    const emitter = new EventEmitter()
    electronApp.emitter = emitter
    electronApp.exit.mockClear()

    await cancelUpdateOnInterrupt(async () => undefined)

    expect(emitter.listenerCount('before-quit')).toBe(0)
    expect(electronApp.exit).not.toHaveBeenCalled()
  })
})
