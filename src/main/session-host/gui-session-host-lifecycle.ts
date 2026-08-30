import type * as Effect from 'effect/Effect'
import {
  configureGuiSessionCommandClient,
  retireGuiSessionCommandClientForUpgrade,
} from '../application/local-session-command-dispatcher'
import type { AppServices } from '../runtime'
import { setGuiAttachedToRemoteSessionHost } from './gui-session-host-state'
import { LocalSessionHostUpgradePendingError, probeLocalSessionHost } from './local-session-client'
import {
  isLocalSessionHostUnavailable,
  waitForLocalSessionHostRelease,
} from './local-session-host-launcher'
import type { LocalSessionHostRuntime } from './local-session-host-runtime'
import { prepareLocalSessionHostPaths, resolveLocalSessionHostPaths } from './local-session-paths'
import { startAppSessionHost } from './session-host-bootstrap'
import { runSessionHostCutover } from './session-host-cutover'
import {
  startRemoteSessionHostRendererBridge,
  startSessionHostRendererBridge,
} from './session-host-renderer-bridge'

type AppEffectRunner = <A, E>(effect: Effect.Effect<A, E, AppServices>) => Promise<A>
const OWNED_HOST_RESTART_DELAY_MS = 250

interface StartGuiSessionHostInput {
  readonly runEffect: AppEffectRunner
  readonly startOwnedServices: () => Promise<void>
  readonly stopOwnedServices: () => Promise<void>
}

export interface GuiSessionHostLifecycle {
  readonly start: (input: StartGuiSessionHostInput) => Promise<'attached' | 'owned'>
  readonly stop: () => Promise<void>
}

export async function prepareGuiSessionHostLifecycle(input: {
  readonly userDataRoot: string
  readonly clientVersion: string
  readonly startupMark: (label: string) => void
}): Promise<GuiSessionHostLifecycle> {
  const paths = resolveLocalSessionHostPaths({ userDataRoot: input.userDataRoot })
  await prepareLocalSessionHostPaths(paths)
  await runSessionHostCutover({
    sourceDatabasePath: paths.legacyDatabasePath,
    targetDatabasePath: paths.databasePath,
    recoveryDatabasePath: paths.recoveryDatabasePath,
  })
  input.startupMark('session-host-cutover-ready')

  const remoteClient = { paths, clientVersion: input.clientVersion }
  let runtime: LocalSessionHostRuntime | null = null
  let stopRendererBridge: (() => void) | null = null
  let stopping = false
  let ownedServicesActive = false
  let stopOwnedServices: (() => Promise<void>) | null = null

  const stopOwnedServicesIfActive = async () => {
    if (!ownedServicesActive) return
    ownedServicesActive = false
    await stopOwnedServices?.()
  }

  const attachToExistingHost = async () => {
    try {
      await probeLocalSessionHost({ ...remoteClient, clientKind: 'gui' })
      if (stopping) return false
      await stopOwnedServicesIfActive()
      configureGuiSessionCommandClient(remoteClient)
      stopRendererBridge = startRemoteSessionHostRendererBridge(remoteClient)
      setGuiAttachedToRemoteSessionHost(true)
      return true
    } catch (error) {
      if (error instanceof LocalSessionHostUpgradePendingError) {
        const released = await waitForLocalSessionHostRelease(paths.endpoint)
        if (released) return false
      }
      if (isLocalSessionHostUnavailable(error)) return false
      throw error
    }
  }

  const installOwnedRuntime: (
    nextRuntime: LocalSessionHostRuntime,
    runEffect: AppEffectRunner,
  ) => void = (nextRuntime, runEffect) => {
    runtime = nextRuntime
    configureGuiSessionCommandClient(null)
    setGuiAttachedToRemoteSessionHost(false)
    stopRendererBridge = startSessionHostRendererBridge(nextRuntime)
    void nextRuntime.waitUntilStopped().then(async () => {
      if (stopping || runtime !== nextRuntime) return
      const retiredForUpgrade = nextRuntime.liveness.drainReason() === 'upgrade'
      stopRendererBridge?.()
      stopRendererBridge = null
      runtime = null
      if (retiredForUpgrade) {
        retireGuiSessionCommandClientForUpgrade()
        setGuiAttachedToRemoteSessionHost(false)
        await stopOwnedServicesIfActive()
        return
      }
      while (!stopping) {
        try {
          const recoveredRuntime = await startAppSessionHost({ paths, runEffect })
          if (stopping) {
            await recoveredRuntime.stop()
            return
          }
          installOwnedRuntime(recoveredRuntime, runEffect)
          return
        } catch {
          if (await attachToExistingHost().catch(() => false)) return
          await new Promise((resolve) => setTimeout(resolve, OWNED_HOST_RESTART_DELAY_MS))
        }
      }
    })
  }

  return {
    start: async ({ runEffect, startOwnedServices, stopOwnedServices: stopServices }) => {
      stopping = false
      stopOwnedServices = stopServices
      if (await attachToExistingHost()) {
        input.startupMark('session-host-listening')
        return 'attached'
      }
      try {
        const ownedRuntime = await startAppSessionHost({ paths, runEffect })
        runtime = ownedRuntime
        await startOwnedServices()
        ownedServicesActive = true
        installOwnedRuntime(ownedRuntime, runEffect)
      } catch (error) {
        const failedRuntime = runtime
        runtime = null
        await failedRuntime?.stop()
        if (!(await attachToExistingHost())) throw error
        input.startupMark('session-host-listening')
        return 'attached'
      }
      input.startupMark('session-host-listening')
      return 'owned'
    },
    stop: async () => {
      stopping = true
      stopRendererBridge?.()
      stopRendererBridge = null
      configureGuiSessionCommandClient(null)
      setGuiAttachedToRemoteSessionHost(false)
      await runtime?.stop()
      runtime = null
      await stopOwnedServicesIfActive()
      stopOwnedServices = null
    },
  }
}
