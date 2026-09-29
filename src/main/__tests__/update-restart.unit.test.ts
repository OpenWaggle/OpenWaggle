import { describe, expect, it, vi } from 'vitest'
import {
  createUpdateRestartController,
  type UpdateRestartChoice,
  type UpdateRestartDependencies,
} from '../update-restart'

function harness(input: {
  readonly activeRuns: readonly number[]
  readonly choice?: UpdateRestartChoice
  readonly installable?: () => boolean
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
    hasInstallableUpdate: vi.fn(input.installable ?? (() => true)),
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

    expect(events).toEqual(['install'])
  })

  it('does nothing when the user cancels', async () => {
    const { controller, events } = harness({ activeRuns: [3], choice: 'cancel' })

    await controller.requestRestart()

    expect(events).toEqual(['choose:3'])
  })

  it('stops active runs before installing when the user restarts now', async () => {
    const { controller, events } = harness({ activeRuns: [2], choice: 'now' })

    await controller.requestRestart()

    expect(events).toEqual(['choose:2', 'interrupt', 'install'])
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
    ])
  })

  it('stops waiting when the downloaded update is no longer installable', async () => {
    let installable = true
    const { controller, dependencies, events } = harness({
      activeRuns: [1],
      choice: 'when-idle',
      installable: () => installable,
    })
    dependencies.wait.mockImplementation(() => {
      installable = false
      return Promise.resolve()
    })

    await controller.requestRestart()
    await settle()

    expect(events).toEqual(['choose:1', 'waiting:1', 'waiting:1', 'waiting:none'])
    expect(dependencies.install).not.toHaveBeenCalled()
  })

  it('ignores the restart action without a downloaded update', async () => {
    const { controller, dependencies } = harness({ activeRuns: [0], installable: () => false })

    await controller.requestRestart()

    expect(dependencies.install).not.toHaveBeenCalled()
  })
})
