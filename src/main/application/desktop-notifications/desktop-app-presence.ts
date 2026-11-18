/**
 * Whether a desktop app is connected to the Session Host: it holds an unscoped event subscription
 * as the desktop caller. While one is, the app shows Desktop notifications; otherwise the Host
 * shows them itself (ADR 0062).
 */
let connectedDesktopSubscriptions = 0

export function acquireDesktopAppPresence() {
  connectedDesktopSubscriptions += 1
  let released = false
  return () => {
    if (released) return
    released = true
    connectedDesktopSubscriptions -= 1
  }
}

export function isDesktopAppConnected() {
  return connectedDesktopSubscriptions > 0
}

/** The caller the desktop app authenticates as (`local-session-authenticator`). */
const DESKTOP_APP_CALLER_ID = 'gui:local-user'

/**
 * A subscription keeps the Host alive; the desktop app's unscoped one also says a desktop app is
 * connected, so it shows Desktop notifications instead of the Host, until it ends.
 */
export function acquireSubscriptionLiveness(
  dependencies: { readonly liveness: { readonly acquire: (reason: 'subscription') => () => void } },
  caller: { readonly callerId: string },
  sessionIds: readonly string[] | undefined,
) {
  const releaseLiveness = dependencies.liveness.acquire('subscription')
  const desktopApp =
    caller.callerId === DESKTOP_APP_CALLER_ID &&
    (sessionIds === undefined || sessionIds.length === 0)
  if (!desktopApp) return releaseLiveness
  const releasePresence = acquireDesktopAppPresence()
  return () => {
    releaseLiveness()
    releasePresence()
  }
}
