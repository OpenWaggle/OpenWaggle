import { describe, expect, it, vi } from 'vitest'
import {
  createUpdateRestartController,
  type UpdateRestartChoice,
  type UpdateRestartDependencies,
  type UpdateRestartState,
} from '../update-restart'

function harness(input: {
  readonly activeRuns: readonly number[]
  readonly choice?: UpdateRestartChoice
  readonly state?: () => UpdateRestartState
}) {
  const counts = [...input.activeRuns]
  const events: string[] = []
  const dependencies = {
    countActiveRuns: vi.fn(() =>
      Promise.resolve(counts.length > 1 ? (counts.shift() ?? 0) : (counts[0] ?? 0)),
    ),
    chooseRestart: vi.fn((activeRuns: number) => {
      events.push(`choose:${activeRuns}`)
      return Promise.resolve(input.choice ?? 'cancel')
    }),
    interruptActiveRuns: vi.fn(() => {
      events.push('interrupt')
      counts.splice(0, counts.length, 0)
      return Promise.resolve()
    }),
    updateState: vi.fn(input.state ?? ((): UpdateRestartState => 'installable')),
    reportWaiting: vi.fn((activeRuns: number | null) => {
      events.push(`waiting:${activeRuns ?? 'none'}`)
    }),
    install: vi.fn(() => {
      events.push('install')
      return Promise.resolve()
    }),
    wait: vi.fn(() => Promise.resolve()),
    pollIntervalMs: 10,
    interruptSettleTimeoutMs: 100,
    logError: vi.fn(),
  } satisfies UpdateRestartDependencies
  return { controller: createUpdateRestartController(dependencies), dependencies, events }
}

async function settle() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

describe('update restart policy', () => {
  it('installs immediately without asking when no agent run is active', async () => {
    const { controller, events } = harness({ activeRuns: [0] })

    await controller.requestRestart()

    expect(events).toEqual(['install', 'waiting:none'])
  })

  it('does nothing when the user cancels', async () => {
    const { controller, events } = harness({ activeRuns: [3], choice: 'cancel' })

    await controller.requestRestart()

    expect(events).toEqual(['choose:3'])
  })

  it('stops active runs before installing when the user restarts now', async () => {
    const { controller, events } = harness({ activeRuns: [2], choice: 'now' })

    await controller.requestRestart()

    expect(events).toEqual(['choose:2', 'interrupt', 'install', 'waiting:none'])
  })

  it('waits until the Session Host is idle, counting runs started later, then installs', async () => {
    const { controller, events } = harness({ activeRuns: [1, 1, 2, 1, 0], choice: 'when-idle' })

    await controller.requestRestart()
    await settle()

    expect(events).toEqual([
      'choose:1',
      'waiting:1',
      'waiting:1',
      'waiting:2',
      'waiting:1',
      'install',
      'waiting:none',
    ])
  })

  it('lets Restart now end the wait', async () => {
    const { controller, dependencies, events } = harness({ activeRuns: [2], choice: 'when-idle' })
    dependencies.wait.mockImplementation(() => new Promise(() => undefined))

    await controller.requestRestart()
    await settle()
    await controller.restartNow()

    expect(events).toEqual([
      'choose:2',
      'waiting:2',
      'waiting:2',
      'waiting:none',
      'interrupt',
      'install',
      'waiting:none',
    ])
  })

  it('keeps waiting through a re-check and stops only when no eligible update remains', async () => {
    const states: UpdateRestartState[] = [
      'installable',
      'installable',
      'pending',
      'installable',
      'none',
    ]
    const { controller, dependencies, events } = harness({
      activeRuns: [1],
      choice: 'when-idle',
      state: () => (states.length > 1 ? (states.shift() ?? 'none') : 'none'),
    })

    await controller.requestRestart()
    await settle()

    expect(events).toEqual(['choose:1', 'waiting:1', 'waiting:1', 'waiting:1', 'waiting:none'])
    expect(dependencies.install).not.toHaveBeenCalled()
  })

  it('lets Restart now wait out a re-check instead of dropping the restart', async () => {
    const states: UpdateRestartState[] = ['pending', 'pending', 'installable']
    const { controller, events } = harness({
      activeRuns: [0],
      state: () => (states.length > 1 ? (states.shift() ?? 'installable') : 'installable'),
    })

    await controller.restartNow()

    expect(events).toEqual(['install', 'waiting:none'])
  })

  it('does not install from Restart now when the re-check leaves no eligible update', async () => {
    const states: UpdateRestartState[] = ['pending', 'none']
    const { controller, dependencies } = harness({
      activeRuns: [0],
      state: () => (states.length > 1 ? (states.shift() ?? 'none') : 'none'),
    })

    await controller.restartNow()

    expect(dependencies.install).not.toHaveBeenCalled()
  })

  it('gives up on Restart now after a bounded re-check and keeps the idle wait', async () => {
    let state: UpdateRestartState = 'installable'
    const { controller, dependencies, events } = harness({
      activeRuns: [1],
      choice: 'when-idle',
      state: () => state,
    })
    const pendingWaits: Array<() => void> = []
    dependencies.wait.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          pendingWaits.push(resolve)
        }),
    )
    await controller.requestRestart()
    await settle()
    state = 'pending'
    dependencies.wait.mockImplementation(() => Promise.resolve())

    await controller.restartNow()

    expect(dependencies.wait).toHaveBeenCalledTimes(1 + 100 / 10)
    expect(dependencies.install).not.toHaveBeenCalled()
    expect(events).not.toContain('waiting:none')
  })

  it('ignores Restart to update while Restart now is settling', async () => {
    let state: UpdateRestartState = 'pending'
    const { controller, dependencies } = harness({ activeRuns: [0], state: () => state })
    let release: () => void = () => undefined
    dependencies.wait.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )

    const restarting = controller.restartNow()
    await settle()
    state = 'installable'
    await controller.requestRestart()
    release()
    await restarting

    expect(dependencies.chooseRestart).not.toHaveBeenCalled()
    expect(dependencies.install).toHaveBeenCalledOnce()
  })

  it('ignores a second Restart to update while the dialog is open', async () => {
    const { controller, dependencies } = harness({ activeRuns: [1], choice: 'cancel' })
    let answer: (choice: UpdateRestartChoice) => void = () => undefined
    dependencies.chooseRestart.mockImplementationOnce(
      () =>
        new Promise<UpdateRestartChoice>((resolve) => {
          answer = resolve
        }),
    )

    const first = controller.requestRestart()
    await settle()
    await controller.requestRestart()
    answer('cancel')
    await first

    expect(dependencies.chooseRestart).toHaveBeenCalledOnce()
  })

  it('ignores the restart action without a downloaded update', async () => {
    const { controller, dependencies } = harness({ activeRuns: [0], state: () => 'none' })

    await controller.requestRestart()

    expect(dependencies.install).not.toHaveBeenCalled()
  })
})
