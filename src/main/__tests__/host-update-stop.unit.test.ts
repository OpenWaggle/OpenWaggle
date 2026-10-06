import { describe, expect, it, vi } from 'vitest'
import {
  type HostUpdateStopDependencies,
  stopSessionHostForUpdate,
  type UpdateRunChoice,
} from '../host-update-stop'

function dependencies(input: {
  readonly runCounts: readonly (number | null)[]
  readonly choice?: UpdateRunChoice
  readonly desktopOpen?: boolean
}) {
  const counts = [...input.runCounts]
  const progress: string[] = []
  const value = {
    desktopAppRunning: () => input.desktopOpen ?? false,
    countActiveRuns: vi.fn(async () =>
      counts.length > 1 ? (counts.shift() ?? null) : (counts[0] ?? null),
    ),
    chooseRunHandling: vi.fn(async () => input.choice ?? 'when-idle'),
    release: vi.fn(async () => 'stopped' as const),
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
})
