import { isBrowserPreviewUrl, normalizeBrowserPreviewUrl } from '@shared/schemas/browser-preview'
import type {
  AuthInfo,
  BluetoothDevice,
  Certificate,
  Event,
  Input,
  LoginAuthenticationResponseDetails,
  WebContentsAudioStateChangedEventParams,
} from 'electron'
import { installBrowserPreviewContextMenu } from './browser-preview-context-menu'
import { synchronizeBrowserPreviewControllerOverlay } from './browser-preview-controller-overlay'
import { monitorBrowserPreviewCrashRecovery } from './browser-preview-crash-monitor'
import { synchronizeBrowserPreviewEditingShortcuts } from './browser-preview-editing-shortcuts'
import { isBrowserPreviewClosePending } from './browser-preview-explicit-close'
import {
  faviconAfterBrowserPreviewNavigation,
  monitorBrowserPreviewFavicon,
} from './browser-preview-favicon-monitor'
import {
  ABORTED_LOAD_ERROR_CODE,
  boundedBrowserPreviewText,
  browserPreviewInputKeyIdentity,
  browserPreviewKeyEventForInput,
  browserPreviewShortcutBindingsMatchInput,
  browserPreviewShortcutForInput,
  browserPreviewStateError,
  isBrowserPreviewNativeShortcutChord,
  MAX_TITLE_LENGTH,
} from './browser-preview-policy'
import { installBrowserPreviewPopupPolicy } from './browser-preview-popup-policy'
import type { BrowserPreviewEventActions, BrowserPreviewRecord } from './browser-preview-records'

function monitorLoadState(record: BrowserPreviewRecord, actions: BrowserPreviewEventActions) {
  const contents = record.view.webContents
  const onStartLoading = () => {
    record.state = { ...record.state, loading: true, error: null }
    actions.emitState()
  }
  const onStopLoading = () => {
    record.state = { ...record.state, loading: false }
    void synchronizeBrowserPreviewControllerOverlay(
      record.view.webContents,
      record.state.controller,
    ).catch(() => undefined)
    actions.snapshot()
    actions.emitState()
  }
  const onNavigate = (_event: Event, url: string) => {
    if (isBrowserPreviewUrl(url)) {
      const normalizedUrl = normalizeBrowserPreviewUrl(url)
      record.state = {
        ...record.state,
        url: normalizedUrl,
        error: null,
        favicon: faviconAfterBrowserPreviewNavigation(record, normalizedUrl),
      }
    }
    actions.snapshot()
    actions.emitState()
  }
  const onTitle = (_event: Event, title: string) => {
    record.state = {
      ...record.state,
      title: boundedBrowserPreviewText(title, MAX_TITLE_LENGTH),
    }
    actions.emitState()
  }
  const onFailLoad = (
    _event: Event,
    errorCode: number,
    errorDescription: string,
    validatedUrl: string,
    isMainFrame: boolean,
  ) => {
    if (!isMainFrame || errorCode === ABORTED_LOAD_ERROR_CODE) return
    record.state = {
      ...record.state,
      loading: false,
      error: browserPreviewStateError(String(errorCode), errorDescription, validatedUrl),
    }
    actions.emitState()
  }

  contents.on('did-start-loading', onStartLoading)
  contents.on('did-stop-loading', onStopLoading)
  contents.on('did-navigate', onNavigate)
  contents.on('did-navigate-in-page', onNavigate)
  contents.on('page-title-updated', onTitle)
  contents.on('did-fail-load', onFailLoad)
  return [
    () => contents.removeListener('did-start-loading', onStartLoading),
    () => contents.removeListener('did-stop-loading', onStopLoading),
    () => contents.removeListener('did-navigate', onNavigate),
    () => contents.removeListener('did-navigate-in-page', onNavigate),
    () => contents.removeListener('page-title-updated', onTitle),
    () => contents.removeListener('did-fail-load', onFailLoad),
  ]
}

function monitorNavigationPolicy(
  record: BrowserPreviewRecord,
  actions: BrowserPreviewEventActions,
) {
  const contents = record.view.webContents
  const blockUnsafeNavigation = (details: Event<{ url: string; isMainFrame: boolean }>) => {
    if (!details.isMainFrame || isBrowserPreviewUrl(details.url)) return
    details.preventDefault()
    record.state = {
      ...record.state,
      loading: false,
      error: browserPreviewStateError(
        'BLOCKED_NAVIGATION',
        'Only HTTP and HTTPS navigation is allowed in browser previews.',
        details.url,
      ),
    }
    actions.emitState()
  }
  const blockContentBoundsUpdate = (event: Event) => event.preventDefault()
  const ignoreBeforeUnload = (event: Event) => event.preventDefault()

  const popupPolicy = installBrowserPreviewPopupPolicy(contents, {
    navigate: actions.navigate,
    onBlocked: (url) => {
      record.state = {
        ...record.state,
        error: browserPreviewStateError(
          'BLOCKED_POPUP',
          'The page requested an unsafe or excessive popup.',
          url,
        ),
      }
      actions.emitState()
    },
  })
  contents.on('will-navigate', blockUnsafeNavigation)
  contents.on('will-redirect', blockUnsafeNavigation)
  contents.on('content-bounds-updated', blockContentBoundsUpdate)
  contents.on('will-prevent-unload', ignoreBeforeUnload)
  return [
    popupPolicy.dispose,
    () => contents.removeListener('will-navigate', blockUnsafeNavigation),
    () => contents.removeListener('will-redirect', blockUnsafeNavigation),
    () => contents.removeListener('content-bounds-updated', blockContentBoundsUpdate),
    () => contents.removeListener('will-prevent-unload', ignoreBeforeUnload),
  ]
}

function monitorSecurityPrompts(record: BrowserPreviewRecord) {
  const contents = record.view.webContents
  const cancelBasicAuth = (
    event: Event,
    _details: LoginAuthenticationResponseDetails,
    _authInfo: AuthInfo,
    callback: (username?: string, password?: string) => void,
  ) => {
    event.preventDefault()
    callback()
  }
  const rejectCertificate = (
    event: Event,
    _url: string,
    _error: string,
    _certificate: Certificate,
    callback: (isTrusted: boolean) => void,
  ) => {
    event.preventDefault()
    callback(false)
  }
  const rejectBluetooth = (
    event: Event,
    _devices: BluetoothDevice[],
    callback: (deviceId: string) => void,
  ) => {
    event.preventDefault()
    callback('')
  }
  const rejectClientCertificate = (
    event: Event,
    _url: string,
    _certificateList: Certificate[],
    callback: (certificate: Certificate) => void,
  ) => {
    event.preventDefault()
    // Electron documents an omitted certificate as rejection, but this
    // WebContents overload types the argument as required.
    Reflect.apply(callback, undefined, [])
  }

  contents.on('login', cancelBasicAuth)
  contents.on('certificate-error', rejectCertificate)
  contents.on('select-bluetooth-device', rejectBluetooth)
  contents.on('select-client-certificate', rejectClientCertificate)
  return [
    () => contents.removeListener('login', cancelBasicAuth),
    () => contents.removeListener('certificate-error', rejectCertificate),
    () => contents.removeListener('select-bluetooth-device', rejectBluetooth),
    () => contents.removeListener('select-client-certificate', rejectClientCertificate),
  ]
}

function monitorInputAndLifecycle(
  record: BrowserPreviewRecord,
  actions: BrowserPreviewEventActions,
) {
  const contents = record.view.webContents
  const isMac = process.platform === 'darwin'
  const onInput = (event: Event, input: Input) => {
    synchronizeBrowserPreviewEditingShortcuts(contents, input)
    const keyIdentity = browserPreviewInputKeyIdentity(input)
    if (input.type === 'keyUp') {
      const wasClaimed = record.claimedShortcutKeys.delete(keyIdentity)
      if (wasClaimed) {
        event.preventDefault()
        const keyEvent = browserPreviewKeyEventForInput(record.previewId, input)
        if (keyEvent !== null) actions.emitKeyEvent(keyEvent)
        return
      }
      if (isBrowserPreviewNativeShortcutChord(input, isMac)) event.preventDefault()
      return
    }
    if (input.type !== 'keyDown') return

    if (browserPreviewShortcutBindingsMatchInput(input, record.owner.shortcutBindings, isMac)) {
      record.claimedShortcutKeys.add(keyIdentity)
      event.preventDefault()
      const keyEvent = browserPreviewKeyEventForInput(record.previewId, input)
      if (keyEvent !== null) actions.emitKeyEvent(keyEvent)
      return
    }

    const shortcut = browserPreviewShortcutForInput(input, isMac)
    if (!shortcut) {
      if (isBrowserPreviewNativeShortcutChord(input, isMac)) event.preventDefault()
      return
    }
    event.preventDefault()
    if (shortcut === 'reload') return actions.reload()
    if (shortcut === 'back') return actions.goBack()
    if (shortcut === 'forward') return actions.goForward()
    actions.emitShortcut(shortcut)
  }
  const onDestroyed = () => {
    if (isBrowserPreviewClosePending(record)) return actions.detachDestroyed()
    record.state = {
      ...record.state,
      loading: false,
      error: browserPreviewStateError(
        'CONTENT_CLOSED',
        'The preview page closed its native content.',
        record.state.url,
      ),
    }
    actions.emitState()
    actions.detachDestroyed()
  }
  const onBlur = () => record.claimedShortcutKeys.clear()

  contents.on('before-input-event', onInput)
  contents.on('blur', onBlur)
  contents.once('destroyed', onDestroyed)
  return [
    () => contents.removeListener('before-input-event', onInput),
    () => contents.removeListener('blur', onBlur),
    () => contents.removeListener('destroyed', onDestroyed),
  ]
}

function monitorAudioState(record: BrowserPreviewRecord, actions: BrowserPreviewEventActions) {
  const contents = record.view.webContents
  const onAudioStateChanged = (event: Event<WebContentsAudioStateChangedEventParams>) => {
    if (record.state.audible === event.audible) return
    record.state = { ...record.state, audible: event.audible }
    actions.emitState()
  }
  contents.on('audio-state-changed', onAudioStateChanged)
  return () => contents.removeListener('audio-state-changed', onAudioStateChanged)
}

export function monitorBrowserPreview(
  record: BrowserPreviewRecord,
  actions: BrowserPreviewEventActions,
) {
  record.removeListeners.push(
    installBrowserPreviewContextMenu(record.view.webContents, record.owner.window),
    ...monitorLoadState(record, actions),
    ...monitorNavigationPolicy(record, actions),
    ...monitorSecurityPrompts(record),
    ...monitorInputAndLifecycle(record, actions),
    monitorAudioState(record, actions),
    monitorBrowserPreviewFavicon(record, actions),
    ...monitorBrowserPreviewCrashRecovery(record, actions),
  )
}
