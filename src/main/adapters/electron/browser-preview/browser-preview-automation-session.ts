import type { BrowserPreviewControllerState } from '@shared/types/browser-preview'
import type { BrowserPreviewAutomationActionEvent } from '@shared/types/browser-preview-automation'
import type { Debugger, Event, Input, MouseInputEvent, WebContents } from 'electron'
import {
  type BrowserPreviewAutomationDiagnosticsState,
  clearBrowserPreviewPendingDiagnostics,
  createBrowserPreviewAutomationDiagnosticsState,
  recordBrowserPreviewCdpMessage,
} from './browser-preview-automation-diagnostics'
import { BrowserPreviewAutomationInputArbitrator } from './browser-preview-automation-input-arbitration'

export interface BrowserPreviewAutomationControlSession {
  readonly tabId: string
  readonly contents: WebContents
  /** Strongly retained for the full attached lifetime; Electron can crash if this wrapper is GC'd. */
  readonly debugger: Debugger
  readonly diagnostics: BrowserPreviewAutomationDiagnosticsState
  readonly timeline: BrowserPreviewAutomationActionEvent[]
  readonly removeListeners: Array<() => void>
  readonly inputArbitrator: BrowserPreviewAutomationInputArbitrator
  readonly onControllerChange: (state: BrowserPreviewControllerState) => void
  controller: BrowserPreviewControllerState
  tail: Promise<void>
  epoch: number
  documentGeneration: number
  debuggerReady: Promise<void> | null
  debuggerOwned: boolean
  disposed: boolean
}

function monitor(
  session: BrowserPreviewAutomationControlSession,
  onDestroyed: (tabId: string) => void,
) {
  const advanceDocumentGeneration = () => {
    session.documentGeneration += 1
    session.inputArbitrator.clear()
    clearBrowserPreviewPendingDiagnostics(session.diagnostics)
  }
  const onInput = (_event: Event, input: Input) => {
    if (!session.inputArbitrator.consumeKeyboard(input)) interruptForHumanControl(session)
  }
  const onMouse = (_event: Event, input: MouseInputEvent) => {
    if (!session.inputArbitrator.consumeMouse(input)) interruptForHumanControl(session)
  }
  const onMessage = (_event: Event, method: string, params: unknown) => {
    if (method === 'Runtime.executionContextsCleared') advanceDocumentGeneration()
    recordBrowserPreviewCdpMessage(session.diagnostics, method, params)
  }
  const onDetach = () => {
    session.debuggerReady = null
    session.debuggerOwned = false
    session.epoch += 1
    session.inputArbitrator.clear()
    clearBrowserPreviewPendingDiagnostics(session.diagnostics)
  }
  const onNavigation = (_event: Event, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
    if (isMainFrame && !isInPlace) advanceDocumentGeneration()
  }
  const destroyed = () => onDestroyed(session.tabId)
  session.contents.on('before-input-event', onInput)
  session.contents.on('before-mouse-event', onMouse)
  session.contents.on('did-start-navigation', onNavigation)
  session.debugger.on('message', onMessage)
  session.debugger.on('detach', onDetach)
  session.contents.once('destroyed', destroyed)
  session.removeListeners.push(
    () => session.contents.removeListener('before-input-event', onInput),
    () => session.contents.removeListener('before-mouse-event', onMouse),
    () => session.contents.removeListener('did-start-navigation', onNavigation),
    () => session.debugger.removeListener('message', onMessage),
    () => session.debugger.removeListener('detach', onDetach),
    () => session.contents.removeListener('destroyed', destroyed),
  )
}

export function createBrowserPreviewAutomationControlSession(
  page: {
    readonly tabId: string
    readonly contents: WebContents
    readonly onControllerChange?: (state: BrowserPreviewControllerState) => void
  },
  onDestroyed: (tabId: string) => void,
): BrowserPreviewAutomationControlSession {
  if (page.contents.isDestroyed()) throw new Error('Browser preview content has been destroyed.')
  const session: BrowserPreviewAutomationControlSession = {
    tabId: page.tabId,
    contents: page.contents,
    debugger: page.contents.debugger,
    diagnostics: createBrowserPreviewAutomationDiagnosticsState(),
    timeline: [],
    removeListeners: [],
    inputArbitrator: new BrowserPreviewAutomationInputArbitrator(),
    onControllerChange: page.onControllerChange ?? (() => undefined),
    controller: { kind: 'human' },
    tail: Promise.resolve(),
    epoch: 0,
    documentGeneration: 0,
    debuggerReady: null,
    debuggerOwned: false,
    disposed: false,
  }
  monitor(session, onDestroyed)
  return session
}

export function disposeBrowserPreviewAutomationControlSession(
  session: BrowserPreviewAutomationControlSession,
) {
  session.disposed = true
  session.epoch += 1
  session.inputArbitrator.clear()
  for (const removeListener of session.removeListeners.splice(0)) removeListener()
  releaseOwnedDebugger(session)
}

export function interruptBrowserPreviewAutomationControlSession(
  session: BrowserPreviewAutomationControlSession,
) {
  session.epoch += 1
  session.inputArbitrator.clear()
  releaseOwnedDebugger(session)
}

export function setBrowserPreviewAutomationController(
  session: BrowserPreviewAutomationControlSession,
  controller: BrowserPreviewControllerState,
) {
  session.controller = controller
  session.onControllerChange(controller)
}

export function updateBrowserPreviewAutomationPointer(
  session: BrowserPreviewAutomationControlSession,
  params: Readonly<Record<string, unknown>> | undefined,
) {
  if (session.controller.kind !== 'agent') return
  const x = params?.x
  const y = params?.y
  if (
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    typeof y !== 'number' ||
    !Number.isFinite(y)
  ) {
    return
  }
  setBrowserPreviewAutomationController(session, {
    ...session.controller,
    pointer: { x, y },
  })
}

function interruptForHumanControl(session: BrowserPreviewAutomationControlSession) {
  session.epoch += 1
  session.inputArbitrator.clear()
  setBrowserPreviewAutomationController(session, { kind: 'human' })
}

function releaseOwnedDebugger(session: BrowserPreviewAutomationControlSession) {
  const debuggerOwned = session.debuggerOwned
  session.debuggerOwned = false
  session.debuggerReady = null
  if (!debuggerOwned || session.contents.isDestroyed()) return
  try {
    if (session.debugger.isAttached()) session.debugger.detach()
  } catch {
    // Ownership is relinquished even when Electron races destruction or external detachment.
  }
}
