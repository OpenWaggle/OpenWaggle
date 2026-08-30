import type * as Effect from 'effect/Effect'
import {
  configureGuiSessionCommandClient,
  retireGuiSessionCommandClientForUpgrade,
} from '../application/local-session-command-dispatcher'
import type { AppServices } from '../runtime'
import { setGuiAttachedToRemoteSessionHost } from './gui-session-host-state'
import { withLegacySessionWriterFence } from './legacy-session-writer-fence'
import { LocalSessionHostUpgradePendingError, probeLocalSessionHost } from './local-session-client'
import {
  isLocalSessionHostUnavailable,
  waitForLocalSessionHostRelease,
} from './local-session-host-launcher'
import type { LocalSessionHostRuntime } from './local-session-host-runtime'
import { prepareLocalSessionHostPaths, resolveLocalSessionHostPaths } from './local-session-paths'
import { startAppSessionHost } from './session-host-bootstrap'
import { runSessionHostCutover, sessionHostTargetExists } from './session-host-cutover'
import {
  startRemoteSessionHostRendererBridge,
  startSessionHostRendererBridge,
} from './session-host-renderer-bridge'

type AppEffectRunner = <A, E>(effect: Effect.Effect<A, E, AppServices>) => Promise<A>
const OWNED_HOST_RESTART_DELAY_MS = 250

class SessionHostDrainedDuringStartupError extends Error {}

function markSessionHostListening(
  startupMark: (label: string) => void,
  mode: 'attached' | 'owned',
) {
  startupMark('session-host-listening')
  return mode
}

interface StartGuiSessionHostInput {
  readonly runEffect: AppEffectRunner
  readonly startOwnedServices: () => Promise<void>
  readonly stopOwnedServices: () => Promise<void>
}

export interface GuiSessionHostLifecycle {
  readonly start: (input: StartGuiSessionHostInput) => Promise<'attached' | 'owned'>
  readonly stop: () => Promise<void>
}

function createOwnedServicesController() {
  let active = false
  let startService: (() => Promise<void>) | null = null
  let stopService: (() => Promise<void>) | null = null
  return {
    configure(start: () => Promise<void>, stop: () => Promise<void>) {
      startService = start
      stopService = stop
    },
    async start() {
      if (active) return
      active = true
      try {
        await startService?.()
      } catch (error) {
        active = false
        await stopService?.()
        throw error
      }
    },
    async stop() {
      if (!active) return
      active = false
      await stopService?.()
    },
    clear() {
      startService = null
      stopService = null
    },
  }
}

async function prepareSessionHostPaths(userDataRoot: string, startupMark: (label: string) => void) {
  const paths = resolveLocalSessionHostPaths({ userDataRoot })
  await prepareLocalSessionHostPaths(paths)
  const cutoverPaths = {
    sourceDatabasePath: paths.legacyDatabasePath,
    targetDatabasePath: paths.databasePath,
    recoveryDatabasePath: paths.recoveryDatabasePath,
  }
  const cutover = () => runSessionHostCutover(cutoverPaths)
  if (await sessionHostTargetExists(cutoverPaths)) await cutover()
  else await withLegacySessionWriterFence(cutover)
  startupMark('session-host-cutover-ready')
  return paths
}

export async function prepareGuiSessionHostLifecycle(input: {
  readonly userDataRoot: string
  readonly clientVersion: string
  readonly startupMark: (label: string) => void
}): Promise<GuiSessionHostLifecycle> {
  const paths = await prepareSessionHostPaths(input.userDataRoot, input.startupMark)
  const remoteClient = { paths, clientVersion: input.clientVersion }
  let runtime: LocalSessionHostRuntime | null = null
  let stopRendererBridge: (() => void) | null = null
  let stopping = false
  const ownedServices = createOwnedServicesController()

  const startOwnedRuntime = async (runEffect: AppEffectRunner) => {
    const ownedRuntime = await startAppSessionHost({
      paths,
      runEffect,
      startOwnedServices: ownedServices.start,
      stopOwnedServices: ownedServices.stop,
    })
    if (ownedRuntime.isStopping()) {
      await ownedRuntime.waitUntilStopped()
      throw new SessionHostDrainedDuringStartupError()
    }
    return ownedRuntime
  }

  const attachToExistingHost = async () => {
    try {
      await probeLocalSessionHost({ ...remoteClient, clientKind: 'gui' })
      if (stopping) return false
      await ownedServices.stop()
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
        await ownedServices.stop()
        return
      }
      while (!stopping) {
        try {
          const recoveredRuntime = await startOwnedRuntime(runEffect)
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
    start: async ({
      runEffect,
      startOwnedServices: startServices,
      stopOwnedServices: stopServices,
    }) => {
      stopping = false
      ownedServices.configure(startServices, stopServices)
      if (await attachToExistingHost()) {
        return markSessionHostListening(input.startupMark, 'attached')
      }
      while (!stopping) {
        try {
          const ownedRuntime = await startOwnedRuntime(runEffect)
          runtime = ownedRuntime
          installOwnedRuntime(ownedRuntime, runEffect)
          return markSessionHostListening(input.startupMark, 'owned')
        } catch (error) {
          const failedRuntime = runtime
          runtime = null
          await failedRuntime?.stop()
          if (await attachToExistingHost()) {
            return markSessionHostListening(input.startupMark, 'attached')
          }
          if (!(error instanceof SessionHostDrainedDuringStartupError)) throw error
        }
      }
      throw new Error('GUI Session Host startup was stopped.')
    },
    stop: async () => {
      stopping = true
      stopRendererBridge?.()
      stopRendererBridge = null
      configureGuiSessionCommandClient(null)
      setGuiAttachedToRemoteSessionHost(false)
      await runtime?.stop()
      runtime = null
      await ownedServices.stop()
      ownedServices.clear()
    },
  }
}
