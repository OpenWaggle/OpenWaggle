/**
 * Update restart policy (docs/release-and-versioning.md, "Update restart and relaunch").
 *
 * An update restart never silently interrupts an agent run. With no active run the update installs
 * immediately. Otherwise the user chooses to restart when the Session Host is idle (the default),
 * to restart now, or to cancel. Restarting now stops the active runs through normal cancellation
 * before installing, so the installer never has to kill a running agent.
 */

export type UpdateRestartChoice = 'when-idle' | 'now' | 'cancel'

export interface UpdateRestartDependencies {
  /** Active agent runs and compactions across every Session the Session Host owns. */
  readonly countActiveRuns: () => Promise<number>
  readonly chooseRestart: (activeRuns: number) => Promise<UpdateRestartChoice>
  /** Stops active runs through normal cancellation, recording them as interrupted. */
  readonly interruptActiveRuns: () => Promise<void>
  /** Whether a downloaded, channel-eligible update is still waiting to be installed. */
  readonly hasInstallableUpdate: () => boolean
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

  const stopWaiting = () => {
    waitGeneration += 1
    if (!waiting) return
    waiting = false
    dependencies.reportWaiting(null)
  }

  const waitUntilIdleThenInstall = async (generation: number) => {
    while (generation === waitGeneration) {
      if (!dependencies.hasInstallableUpdate()) {
        stopWaiting()
        return
      }
      const activeRuns = await dependencies.countActiveRuns()
      if (generation !== waitGeneration) return
      if (activeRuns === 0) {
        waiting = false
        await dependencies.install()
        return
      }
      dependencies.reportWaiting(activeRuns)
      await dependencies.wait(dependencies.pollIntervalMs)
    }
  }

  const restartNow = async () => {
    stopWaiting()
    if (!dependencies.hasInstallableUpdate()) return
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
    await dependencies.install()
  }

  /** The Restart to update action. */
  const requestRestart = async () => {
    if (waiting || !dependencies.hasInstallableUpdate()) return
    const activeRuns = await dependencies.countActiveRuns()
    if (activeRuns === 0) {
      await dependencies.install()
      return
    }
    const choice = await dependencies.chooseRestart(activeRuns)
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
