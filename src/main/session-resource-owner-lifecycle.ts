import { SESSION_RESOURCE_PROTOCOL } from '@shared/constants/session-resource-protocol'
import type { SessionId } from '@shared/types/brand'
import type { Event, WebContents, WebContentsDidStartNavigationEventParams } from 'electron'
import {
  isSessionResourceDownloadNavigation,
  unregisterSessionResourceContentReferencesForOwner,
} from './session-resource-protocol'

type PurgeOwner = (ownerId: number) => void

interface MonitoredOwner {
  readonly sender: WebContents
  readonly purgeOwner: PurgeOwner
  sessionId: SessionId | null
  controller: AbortController
  routeSessionKnown: boolean
}

const monitoredOwners = new Map<number, MonitoredOwner>()

function invalidateOwner(owner: MonitoredOwner, forgetRouteSession = false) {
  owner.controller.abort()
  owner.sessionId = null
  if (forgetRouteSession) owner.routeSessionKnown = false
  owner.purgeOwner(owner.sender.id)
}

function startOwnerSession(owner: MonitoredOwner, sessionId: SessionId) {
  owner.sessionId = sessionId
  owner.controller = new AbortController()
}

export function monitorSessionResourceContentOwner(
  sender: WebContents,
  purgeOwner: PurgeOwner = unregisterSessionResourceContentReferencesForOwner,
) {
  const existing = monitoredOwners.get(sender.id)
  if (existing?.sender === sender) return existing
  const owner: MonitoredOwner = {
    sender,
    purgeOwner,
    sessionId: null,
    controller: new AbortController(),
    routeSessionKnown: false,
  }
  monitoredOwners.set(sender.id, owner)
  const onNavigation = (event: Event<WebContentsDidStartNavigationEventParams>) => {
    if (!event.isMainFrame || event.isSameDocument) return
    // Chromium announces attachment downloads as navigation even though the document stays open.
    if (
      event.url.startsWith(`${SESSION_RESOURCE_PROTOCOL.SCHEME}:`) &&
      isSessionResourceDownloadNavigation(event.url, sender.id, sender.getURL())
    )
      return
    invalidateOwner(owner, true)
  }
  const stopMonitoring = () => {
    sender.removeListener('did-start-navigation', onNavigation)
    sender.removeListener('render-process-gone', onRenderProcessGone)
    sender.removeListener('destroyed', onDestroyed)
    if (monitoredOwners.get(sender.id) === owner) monitoredOwners.delete(sender.id)
  }
  const onRenderProcessGone = () => {
    invalidateOwner(owner)
    stopMonitoring()
  }
  const onDestroyed = () => {
    invalidateOwner(owner)
    stopMonitoring()
  }
  sender.on('did-start-navigation', onNavigation)
  sender.once('render-process-gone', onRenderProcessGone)
  sender.once('destroyed', onDestroyed)
  return owner
}

export function beginSessionResourceContentRequest(sender: WebContents, sessionId: SessionId) {
  const owner = monitorSessionResourceContentOwner(sender)
  // Older renderer documents do not announce their route. Preserve their single-Session behavior,
  // but once a current renderer has announced B (or explicitly cleared its route), a delayed read
  // for A must never be able to switch authority back to A.
  if (!owner.routeSessionKnown && owner.sessionId !== sessionId) {
    invalidateOwner(owner)
    startOwnerSession(owner, sessionId)
  }
  const controller = owner.controller
  return {
    isCurrent: () =>
      !controller.signal.aborted &&
      monitoredOwners.get(sender.id) === owner &&
      owner.sessionId === sessionId &&
      owner.controller === controller,
  }
}

/**
 * Keeps opaque resource capabilities aligned with the Session currently displayed by a renderer.
 * Route changes call this even when the destination Session never reads a resource, so a stale
 * image element or copied capability URL cannot retain access to the previously displayed Session.
 */
export function activateSessionResourceContentOwner(
  sender: WebContents,
  sessionId: SessionId | null,
) {
  const owner = monitorSessionResourceContentOwner(sender)
  if (owner.sessionId === sessionId && !owner.controller.signal.aborted) {
    owner.routeSessionKnown = true
    return
  }
  invalidateOwner(owner)
  owner.routeSessionKnown = true
  if (sessionId === null) return
  startOwnerSession(owner, sessionId)
}
