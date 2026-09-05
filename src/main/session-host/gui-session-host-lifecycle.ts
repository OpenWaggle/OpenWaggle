import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { configureGuiSessionCommandClient } from '../application/local-session-command-dispatcher'
import { prepareGuiSessionHostStartup } from './gui-session-host-startup'
import { setGuiAttachedToRemoteSessionHost } from './gui-session-host-state'
import { LocalSessionHostUpgradePendingError, probeLocalSessionHost } from './local-session-client'
import {
  ensureLocalSessionHost,
  isLocalSessionHostUnavailable,
  waitForLocalSessionHostRelease,
} from './local-session-host-launcher'
import type { LocalSessionHostPaths } from './local-session-paths'
import { refreshLocalSessionHostEndpoint } from './local-session-paths'
import { startRemoteSessionHostRendererBridge } from './session-host-renderer-bridge'

function guiRemoteClient(paths: LocalSessionHostPaths, clientVersion: string) {
  return { paths, clientVersion, supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION] }
}

export interface GuiSessionHostLifecycle {
  readonly start: () => Promise<void>
  readonly stop: () => Promise<void>
}

async function attachToRemoteSessionHost(input: {
  readonly client: { readonly paths: LocalSessionHostPaths; readonly clientVersion: string }
  readonly isStopping: () => boolean
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
}): Promise<GuiSessionHostLifecycle> {
  const { paths } = await prepareGuiSessionHostStartup(input)
  const remoteClient = guiRemoteClient(paths, input.clientVersion)
  let stopRendererBridge: (() => void | Promise<void>) | null = null
  let stopping = false

  const attachToExistingHost = async () => {
    const stopBridge = await attachToRemoteSessionHost({
      client: remoteClient,
      isStopping: () => stopping,
    })
    if (!stopBridge) return false
    stopRendererBridge = stopBridge
    return true
  }

  return {
    start: async () => {
      stopping = false
      if (!(await attachToExistingHost())) {
        if (stopping) throw new Error('GUI Session Host startup was stopped.')
        await ensureLocalSessionHost({
          ...remoteClient,
          clientKind: 'gui',
        })
        if (!(await attachToExistingHost())) {
          if (stopping) throw new Error('GUI Session Host startup was stopped.')
          throw new Error('The isolated GUI could not attach to an authoritative Session Host.')
        }
      }
      input.startupMark('session-host-listening')
    },
    stop: async () => {
      stopping = true
      const stopBridge = stopRendererBridge
      stopRendererBridge = null
      try {
        await stopBridge?.()
      } finally {
        configureGuiSessionCommandClient(null)
        setGuiAttachedToRemoteSessionHost(false)
      }
    },
  }
}
