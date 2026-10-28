import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { configureGuiSessionCommandClient } from '../application/gui-session-command-router'
import { createLogger } from '../logger'
import { prepareGuiSessionHostStartup } from './gui-session-host-startup'
import { setGuiAttachedToRemoteSessionHost } from './gui-session-host-state'
import { LocalSessionHostUpgradePendingError, probeLocalSessionHost } from './local-session-client'
import {
  ensureLocalSessionHost,
  isLocalSessionHostUnavailable,
  waitForLocalSessionHostRelease,
  waitForPrelaunchedLocalSessionHost,
} from './local-session-host-launcher'
import type { LocalSessionHostPaths } from './local-session-paths'
import { refreshLocalSessionHostEndpoint } from './local-session-paths'
import {
  hasSessionHostPrelaunch,
  type SessionHostPrelaunch,
  takeSessionHostPrelaunch,
} from './session-host-prelaunch-handoff'
import { startRemoteSessionHostRendererBridge } from './session-host-renderer-bridge'
import { releaseSessionHostForUpdate } from './session-host-update-release'

const logger = createLogger('gui-session-host')

function guiRemoteClient(paths: LocalSessionHostPaths, clientVersion: string) {
  return { paths, clientVersion, supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION] }
}

export interface GuiSessionHostStopOptions {
  /** Also stop the detached Host and wait for it to exit, because an update is installing. */
  readonly releaseHostForUpdate?: boolean
}

export interface GuiSessionHostLifecycle {
  readonly client: { readonly paths: LocalSessionHostPaths; readonly clientVersion: string }
  /** An aborted start stops waiting for a Host to listen; a Retry starts a new one. */
  readonly start: (signal?: AbortSignal) => Promise<void>
  readonly stop: (options?: GuiSessionHostStopOptions) => Promise<void>
}

async function attachToRemoteSessionHost(input: {
  readonly client: { readonly paths: LocalSessionHostPaths; readonly clientVersion: string }
  readonly isStopping: () => boolean
  readonly onUpgradePending?: () => void
}) {
  let currentPaths = input.client.paths
  try {
    currentPaths = await refreshLocalSessionHostEndpoint(currentPaths)
    const client = {
      ...input.client,
      paths: currentPaths,
    }
    await probeLocalSessionHost({ ...client, clientKind: 'gui' })
    if (input.isStopping()) return null
    configureGuiSessionCommandClient(client)
    setGuiAttachedToRemoteSessionHost(true)
    return startRemoteSessionHostRendererBridge(client)
  } catch (error) {
    if (error instanceof LocalSessionHostUpgradePendingError) {
      input.onUpgradePending?.()
      const released = await waitForLocalSessionHostRelease(currentPaths.endpoint)
      if (released) return null
    }
    if (isLocalSessionHostUnavailable(error)) return null
    throw error
  }
}

export async function prepareGuiSessionHostLifecycle(input: {
  readonly userDataRoot: string
  readonly clientVersion: string
  readonly startupMark: (label: string) => void
  /** The running Host is handing over to an update, and attaching waits until it has. */
  readonly onUpgradePending?: () => void
  /** This start attached to a running Host or launched one: the Host's own startup is under way. */
  readonly onHostUnderway?: () => void
  /** Whether the boot shim launched this profile's Host (`boot/session-host-prelaunch`). */
  readonly hasPrelaunchedHost?: (userDataRoot: string) => boolean
  /** That Host, taken once: a Retry launches as usual. */
  readonly takePrelaunchedHost?: (userDataRoot: string) => SessionHostPrelaunch | null
  /** Waits for that Host to answer; false once it ended without answering. */
  readonly waitForPrelaunchedHost?: typeof waitForPrelaunchedLocalSessionHost
}): Promise<GuiSessionHostLifecycle> {
  const takePrelaunchedHost = input.takePrelaunchedHost ?? takeSessionHostPrelaunch
  const hostPrelaunched = (input.hasPrelaunchedHost ?? hasSessionHostPrelaunch)(input.userDataRoot)
  const { paths } = await prepareGuiSessionHostStartup({ ...input, hostPrelaunched })
  const remoteClient = guiRemoteClient(paths, input.clientVersion)
  let stopRendererBridge: (() => void | Promise<void>) | null = null
  let stopping = false

  const attachToExistingHost = async () => {
    const stopBridge = await attachToRemoteSessionHost({
      client: remoteClient,
      isStopping: () => stopping,
      ...(input.onUpgradePending ? { onUpgradePending: input.onUpgradePending } : {}),
    })
    if (!stopBridge) return false
    stopRendererBridge = stopBridge
    input.onHostUnderway?.()
    return true
  }

  /** Attaches to the Host the boot shim launched, once it answers; false if it ended first. */
  const attachToPrelaunchedHost = async (signal?: AbortSignal) => {
    const prelaunch = takePrelaunchedHost(input.userDataRoot)
    if (!prelaunch) return false
    input.startupMark('session-host-prelaunch-adopted')
    input.onHostUnderway?.()
    const waitForPrelaunchedHost =
      input.waitForPrelaunchedHost ?? waitForPrelaunchedLocalSessionHost
    const answered = await waitForPrelaunchedHost({
      ...remoteClient,
      clientKind: 'gui',
      prelaunch,
      ...(signal ? { signal } : {}),
    })
    signal?.throwIfAborted()
    return answered && (await attachToExistingHost())
  }

  return {
    client: remoteClient,
    start: async (signal) => {
      stopping = false
      // Attached already: a second attachment would forward every Host event twice and leak.
      if (stopRendererBridge) return
      if (!(await attachToExistingHost()) && !(await attachToPrelaunchedHost(signal))) {
        if (stopping) throw new Error('GUI Session Host startup was stopped.')
        signal?.throwIfAborted()
        await ensureLocalSessionHost({
          ...remoteClient,
          clientKind: 'gui',
          ...(signal ? { signal } : {}),
          ...(input.onUpgradePending ? { onUpgradePending: input.onUpgradePending } : {}),
          onLaunched: () => {
            input.startupMark('session-host-launched')
            input.onHostUnderway?.()
          },
        })
        signal?.throwIfAborted()
        if (!(await attachToExistingHost())) {
          if (stopping) throw new Error('GUI Session Host startup was stopped.')
          throw new Error('The isolated GUI could not attach to an authoritative Session Host.')
        }
      }
      input.startupMark('session-host-listening')
    },
    stop: async (options = {}) => {
      stopping = true
      const stopBridge = stopRendererBridge
      stopRendererBridge = null
      try {
        await stopBridge?.()
      } finally {
        configureGuiSessionCommandClient(null)
        setGuiAttachedToRemoteSessionHost(false)
        // Detached first, so nothing in this app can start a new Host while the old one stops.
        if (options.releaseHostForUpdate) {
          const outcome = await releaseSessionHostForUpdate({ ...remoteClient, clientKind: 'gui' })
          logger.info('Released the Session Host for an update', { outcome })
        }
      }
    },
  }
}
