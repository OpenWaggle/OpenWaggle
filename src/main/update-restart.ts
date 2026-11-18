/**
 * Update restart policy (docs/release-and-versioning.md, "Update restart and relaunch").
 *
 * An update restart never silently interrupts an agent run, except one that starts while the update
 * already shows as installing (ADR 0047). With no active run the update installs
 * immediately. Otherwise the user chooses to restart when the Session Host is idle (the default),
 * to restart now, or to cancel. Restarting now stops the active runs through normal cancellation
 * and waits a bounded time for them to settle before installing.
 */

export type UpdateRestartChoice = 'when-idle' | 'now' | 'cancel'

/**
 * `installable`: a downloaded, channel-eligible update is ready. `pending`: the updater is
 * re-checking or re-downloading (a periodic or manual check), or that check failed transiently; a
 * Restart when idle wait survives it.
 * `none`: no eligible update remains, for example after the Update channel changed.
 */
export type UpdateRestartState = 'installable' | 'pending' | 'none'

export interface UpdateRestartDependencies {
  /** Active agent runs and compactions across every Session the Session Host owns. */
  readonly countActiveRuns: () => Promise<number>
  readonly chooseRestart: (activeRuns: number) => Promise<UpdateRestartChoice>
  /** Stops active runs and compactions through normal cancellation, recording them as interrupted. */
  readonly interruptActiveRuns: () => Promise<void>
  readonly updateState: () => UpdateRestartState
  readonly reportWaiting: (activeRuns: number | null) => void
  readonly install: () => Promise<void>
  readonly wait: (milliseconds: number) => Promise<void>
  readonly pollIntervalMs: number
  /** Upper bound for runs to settle after Restart now asks them to stop. */
  readonly interruptSettleTimeoutMs: number
  readonly logError: (message: string, error: unknown) => void
}

export function createUpdateRestartController(dependencies: UpdateRestartDependencies) {
  let waitGeneration = 0
  let waiting = false
  let choosing = false
  let restarting = false

  const stopWaiting = () => {
    waitGeneration += 1
    if (!waiting) return
    waiting = false
    dependencies.reportWaiting(null)
  }

  // Installing normally quits the app; if the updater declined (its state changed), clear any
  // waiting indicator so the UI does not keep promising an install that will not happen. The idle
  // wait and Restart now can both reach this at once, so only one install runs at a time.
  let installation: Promise<void> | null = null
  const install = () => {
    installation ??= dependencies
      .install()
      .then(() => dependencies.reportWaiting(null))
      .finally(() => {
        installation = null
      })
    return installation
  }

  const waitUntilIdleThenInstall = async (generation: number) => {
    while (generation === waitGeneration) {
      const state = dependencies.updateState()
      if (state === 'none') {
        stopWaiting()
        return
      }
      if (state === 'installable') {
        const activeRuns = await dependencies.countActiveRuns()
        if (generation !== waitGeneration) return
        if (activeRuns === 0) {
          waiting = false
          await install()
          return
        }
        dependencies.reportWaiting(activeRuns)
      }
      await dependencies.wait(dependencies.pollIntervalMs)
    }
  }

  // A re-check in flight keeps the update pending; give it a bounded time to settle.
  const settledUpdateState = async () => {
    let state = dependencies.updateState()
    let waitedFor = 0
    while (state === 'pending' && waitedFor < dependencies.interruptSettleTimeoutMs) {
      await dependencies.wait(dependencies.pollIntervalMs)
      waitedFor += dependencies.pollIntervalMs
      state = dependencies.updateState()
    }
    return state
  }

  const interruptAndInstall = async () => {
    if ((await dependencies.countActiveRuns()) > 0) {
      await dependencies.interruptActiveRuns()
      let settledFor = 0
      while (
        settledFor < dependencies.interruptSettleTimeoutMs &&
        (await dependencies.countActiveRuns()) > 0
      ) {
        await dependencies.wait(dependencies.pollIntervalMs)
        settledFor += dependencies.pollIntervalMs
      }
    }
    await install()
  }

  const restartNow = async () => {
    if (restarting) return
    restarting = true
    try {
      const state = await settledUpdateState()
      // Still re-checking: never interrupt runs later without the user seeing it. Any Restart when
      // idle wait keeps running and remains visible once the update is downloaded again.
      if (state === 'pending') return
      stopWaiting()
      if (state === 'installable') await interruptAndInstall()
    } finally {
      restarting = false
    }
  }

  /** The Restart to update action. */
  const requestRestart = async () => {
    if (waiting || choosing || restarting || dependencies.updateState() !== 'installable') return
    const activeRuns = await dependencies.countActiveRuns()
    if (activeRuns === 0) {
      await install()
      return
    }
    choosing = true
    const choice = await dependencies.chooseRestart(activeRuns).finally(() => {
      choosing = false
    })
    if (choice === 'cancel') return
    if (choice === 'now') {
      await restartNow()
      return
    }
    waitGeneration += 1
    waiting = true
    dependencies.reportWaiting(activeRuns)
    void waitUntilIdleThenInstall(waitGeneration).catch((error: unknown) => {
      stopWaiting()
      dependencies.logError('Waiting to restart for the update failed', error)
    })
  }

  return { requestRestart, restartNow, stopWaiting }
}
