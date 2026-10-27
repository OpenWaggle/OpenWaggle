/**
 * Renderer requests that need the Session Host wait here until the GUI's backend is ready
 * (A-F2, maintainer decision 3): the window opens and registers its IPC handlers before the Host
 * answers, and a request made meanwhile is held, not refused and not answered from the GUI's own
 * state. Open unless startup holds it, so tests and other processes never wait.
 */
let gate: Promise<void> = Promise.resolve()
let release: (() => void) | null = null

/** Holds every gated request until `releaseGuiBackendGate`; a second hold is the same hold. */
export function holdGuiBackendGate() {
  if (release) return
  const held = Promise.withResolvers<void>()
  gate = held.promise
  release = held.resolve
}

export function releaseGuiBackendGate() {
  release?.()
  release = null
  gate = Promise.resolve()
}

export function isGuiBackendGateHeld() {
  return release !== null
}

/** Resolves once the backend is ready; never rejects. A failed start keeps requests waiting. */
export function waitForGuiBackend(): Promise<void> {
  return gate
}
