import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import {
  configureGuiSessionCommandClient,
  retireGuiSessionCommandClientForUpgrade,
} from '../application/local-session-command-dispatcher'
import type { AppDatabaseAccess } from '../services/database-service'
import {
  type AppEffectRunner,
  createGuiSessionHostStarter,
  SessionHostDrainedDuringStartupError,
  type StartGuiSessionHostInput,
} from './gui-session-host-starter'
import {
  type GuiSessionHostOwnershipController,
  prepareGuiSessionHostStartup,
} from './gui-session-host-startup'
import { setGuiAttachedToRemoteSessionHost } from './gui-session-host-state'
import { LocalSessionHostUpgradePendingError, probeLocalSessionHost } from './local-session-client'
import {
  isLocalSessionHostUnavailable,
  waitForLocalSessionHostRelease,
} from './local-session-host-launcher'
import type { LocalSessionHostRuntime } from './local-session-host-runtime'
import type { LocalSessionHostPaths } from './local-session-paths'
import { startAppSessionHost } from './session-host-bootstrap'
import {
  startRemoteSessionHostRendererBridge,
  startSessionHostRendererBridge,
} from './session-host-renderer-bridge'

const OWNED_HOST_RESTART_DELAY_MS = 250

function guiRemoteClient(paths: LocalSessionHostPaths, clientVersion: string) {
  return { paths, clientVersion, supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION] }
}

export interface GuiSessionHostLifecycle {
  readonly databaseAccess: AppDatabaseAccess
  readonly start: (input: StartGuiSessionHostInput) => Promise<'attached' | 'owned'>
  readonly stop: () => Promise<void>
  readonly releaseOwnership: () => Promise<void>
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

async function attachToRemoteSessionHost(input: {
  readonly client: { readonly paths: LocalSessionHostPaths; readonly clientVersion: string }
  readonly isStopping: () => boolean
  readonly stopOwnedServices: () => Promise<void>
}) {
  try {
    await probeLocalSessionHost({ ...input.client, clientKind: 'gui' })
    if (input.isStopping()) return null
    await input.stopOwnedServices()
    configureGuiSessionCommandClient(input.client)
    setGuiAttachedToRemoteSessionHost(true)
    return startRemoteSessionHostRendererBridge(input.client)
  } catch (error) {
    if (error instanceof LocalSessionHostUpgradePendingError) {
      const released = await waitForLocalSessionHostRelease(input.client.paths.endpoint)
      if (released) return null
    }
    if (isLocalSessionHostUnavailable(error)) return null
    throw error
  }
}

async function startOwnedSessionHostRuntime(input: {
  readonly paths: LocalSessionHostPaths
  readonly ownership: GuiSessionHostOwnershipController
  readonly runEffect: AppEffectRunner
  readonly startOwnedServices: () => Promise<void>
  readonly stopOwnedServices: () => Promise<void>
}) {
  const externalOwnership = await input.ownership.ensure()
  return startAppSessionHost({
    paths: input.paths,
    externalOwnership,
    runEffect: input.runEffect,
    startOwnedServices: input.startOwnedServices,
    stopOwnedServices: input.stopOwnedServices,
  })
}

function stopGuiSessionHostLifecycle(input: {
  readonly setStopping: () => void
  readonly stopRendererBridge: () => void
  readonly stopRuntime: () => Promise<void>
  readonly stopOwnedServices: () => Promise<void>
  readonly clearOwnedServices: () => void
}) {
  return async () => {
    input.setStopping()
    input.stopRendererBridge()
    configureGuiSessionCommandClient(null)
    setGuiAttachedToRemoteSessionHost(false)
    await input.stopRuntime()
    await input.stopOwnedServices()
    input.clearOwnedServices()
  }
}

export async function prepareGuiSessionHostLifecycle(input: {
  readonly userDataRoot: string
  readonly clientVersion: string
  readonly startupMark: (label: string) => void
  readonly requestShutdownForHandoff?: () => void
}): Promise<GuiSessionHostLifecycle> {
  const { paths, ownership, databaseAccess } = await prepareGuiSessionHostStartup(input)
  const remoteClient = guiRemoteClient(paths, input.clientVersion)
  let runtime: LocalSessionHostRuntime | null = null
  let stopRendererBridge: (() => void) | null = null
  let stopping = false
  const ownedServices = createOwnedServicesController()

  const startOwnedRuntime = async (runEffect: AppEffectRunner) => {
    const ownedRuntime = await startOwnedSessionHostRuntime({
      paths,
      ownership,
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
    const stopBridge = await attachToRemoteSessionHost({
      client: remoteClient,
      isStopping: () => stopping,
      stopOwnedServices: ownedServices.stop,
    })
    if (!stopBridge) return false
    stopRendererBridge = stopBridge
    return true
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
        input.requestShutdownForHandoff?.()
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
          await new Promise((resolve) => setTimeout(resolve, OWNED_HOST_RESTART_DELAY_MS))
        }
      }
    })
  }

  return {
    databaseAccess,
    start: createGuiSessionHostStarter({
      databaseAccess,
      remoteClient,
      startupMark: input.startupMark,
      ...(input.requestShutdownForHandoff
        ? { requestShutdownForHandoff: input.requestShutdownForHandoff }
        : {}),
      configureOwnedServices: ownedServices.configure,
      attachToExistingHost,
      startOwnedRuntime,
      installOwnedRuntime,
      setStopping: (next) => {
        stopping = next
      },
      isStopping: () => stopping,
      stopFailedRuntime: async () => {
        const failedRuntime = runtime
        runtime = null
        await failedRuntime?.stop()
      },
    }),
    stop: stopGuiSessionHostLifecycle({
      setStopping: () => {
        stopping = true
      },
      stopRendererBridge: () => {
        stopRendererBridge?.()
        stopRendererBridge = null
      },
      stopRuntime: async () => {
        await runtime?.stop()
        runtime = null
      },
      stopOwnedServices: ownedServices.stop,
      clearOwnedServices: ownedServices.clear,
    }),
    releaseOwnership: ownership.release,
  }
}
