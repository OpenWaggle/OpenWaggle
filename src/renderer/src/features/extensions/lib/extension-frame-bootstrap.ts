import {
  EXTENSION_FRAME_MESSAGE_CHANNEL,
  OPENWAGGLE_EXTENSION_FRAME_PROTOCOL,
  OPENWAGGLE_EXTENSION_FRAME_ROOT_ID,
} from '@shared/constants/extension-frame'
import type { ExtensionSdkInvokeRequest } from '@shared/extension-sdk-core'
import { extensionThemeCssVariableEntries } from '@shared/extension-theme'
import type { ExtensionInvokeResult } from '@shared/types/extension-broker'
import type { ExtensionFrameConfig } from '@shared/types/extension-frame'
import type { JsonValue } from '@shared/types/json'
import type { OpenWaggleExtensionMountContext } from './extension-federated-module'
import { createFrameExtensionSdk } from './extension-frame-bootstrap-sdk'
import { decodedParentMessage, isFederatedModule } from './extension-frame-bootstrap-validation'

const RESIZE_OBSERVER_TYPE = 'function'

type ExtensionFrameChildMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'mounted' }
  | { readonly type: 'error' | 'cleanup-error'; readonly message: string }
  | {
      readonly type: 'invoke'
      readonly requestId: string
      readonly input: ExtensionSdkInvokeRequest
    }
  | { readonly type: 'open-external'; readonly url: string }
  | { readonly type: 'resize'; readonly height: number }
  | { readonly type: 'surface-action'; readonly actionId: string; readonly payload?: JsonValue }

let activeConfig: ExtensionFrameConfig | null = null
let cleanup: (() => void) | null = null
let disposed = false
let invokeSequence = 0
let resizeAnimationFrame = 0
let resizeObserver: ResizeObserver | null = null

const pendingInvocations = new Map<string, (result: ExtensionInvokeResult) => void>()
const frameId = frameIdFromLocation()

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function frameIdFromLocation() {
  const pathSegments = window.location.pathname.split('/').filter((segment) => segment.length > 0)
  const prefixSegments = OPENWAGGLE_EXTENSION_FRAME_PROTOCOL.FRAME_PATH_PREFIX.split('/').filter(
    (segment) => segment.length > 0,
  )
  const [prefixSegment] = prefixSegments
  const [actualPrefix, encodedFrameId] = pathSegments
  if (prefixSegments.length !== 1 || actualPrefix !== prefixSegment || !encodedFrameId) {
    throw new Error('Invalid OpenWaggle extension frame URL.')
  }

  try {
    const decodedFrameId = decodeURIComponent(encodedFrameId)
    if (decodedFrameId.length === 0) {
      throw new Error('Missing OpenWaggle extension frame id.')
    }
    return decodedFrameId
  } catch (error) {
    throw new Error(`Invalid OpenWaggle extension frame id: ${describeError(error)}.`, {
      cause: error,
    })
  }
}

function post(message: ExtensionFrameChildMessage) {
  window.parent.postMessage({ channel: EXTENSION_FRAME_MESSAGE_CHANNEL, frameId, ...message }, '*')
}

function measureFrameHeight(root: HTMLElement) {
  return Math.ceil(
    Math.max(root.scrollHeight, document.body.scrollHeight, document.documentElement.scrollHeight),
  )
}

function postFrameHeight(root: HTMLElement) {
  resizeAnimationFrame = 0
  if (!disposed) {
    post({ type: 'resize', height: measureFrameHeight(root) })
  }
}

function scheduleFrameResize(root: HTMLElement) {
  if (resizeAnimationFrame !== 0) {
    return
  }

  resizeAnimationFrame = requestAnimationFrame(() => postFrameHeight(root))
}

function startResizeObserver(root: HTMLElement) {
  scheduleFrameResize(root)
  if (typeof ResizeObserver !== RESIZE_OBSERVER_TYPE) {
    return
  }

  resizeObserver = new ResizeObserver(() => scheduleFrameResize(root))
  resizeObserver.observe(root)
  resizeObserver.observe(document.body)
}

function stopResizeObserver() {
  if (resizeObserver !== null) {
    resizeObserver.disconnect()
    resizeObserver = null
  }

  if (resizeAnimationFrame !== 0) {
    cancelAnimationFrame(resizeAnimationFrame)
    resizeAnimationFrame = 0
  }
}

function runCleanup() {
  stopResizeObserver()
  if (cleanup === null) {
    return
  }

  const cleanupCallback = cleanup
  cleanup = null
  try {
    cleanupCallback()
  } catch (error) {
    post({ type: 'cleanup-error', message: describeError(error) })
  }
}

function invoke(input: ExtensionSdkInvokeRequest) {
  const requestId = String(++invokeSequence)
  post({ type: 'invoke', requestId, input })
  return new Promise<ExtensionInvokeResult>((resolve) => {
    pendingInvocations.set(requestId, resolve)
  })
}

function mountContext(input: {
  readonly config: ExtensionFrameConfig
  readonly root: HTMLElement
}): OpenWaggleExtensionMountContext {
  return {
    ...input.config.context,
    root: input.root,
    sdk: createFrameExtensionSdk({ invokeBroker: invoke, post }),
  }
}

function applyExtensionTheme(config: ExtensionFrameConfig) {
  for (const entry of extensionThemeCssVariableEntries(config.context.theme)) {
    document.documentElement.style.setProperty(entry.name, entry.value)
  }
}

function handleParentMessage(root: HTMLElement, event: MessageEvent<unknown>) {
  if (event.source !== window.parent) {
    return
  }

  const message = decodedParentMessage(event.data, frameId)
  if (message === null) {
    return
  }

  if (message.type === 'dispose') {
    disposed = true
    runCleanup()
    return
  }

  if (message.type === 'configure') {
    if (activeConfig !== null) {
      return
    }

    activeConfig = message.config
    applyExtensionTheme(message.config)
    void mountExtensionFrame({ config: message.config, root })
    return
  }

  const resolve = pendingInvocations.get(message.requestId)
  if (!resolve) {
    return
  }

  pendingInvocations.delete(message.requestId)
  resolve(message.result)
}

function rootElement() {
  const root = document.getElementById(OPENWAGGLE_EXTENSION_FRAME_ROOT_ID)
  if (root === null) {
    throw new Error('Missing OpenWaggle extension frame root.')
  }

  return root
}

async function mountExtensionFrame(input: {
  readonly config: ExtensionFrameConfig
  readonly root: HTMLElement
}) {
  try {
    const extensionModule: unknown = await import(/* @vite-ignore */ input.config.moduleUrl)
    if (!isFederatedModule(extensionModule)) {
      throw new Error('Extension federated module must export a mount(context) function.')
    }

    const mountResult = await extensionModule.mount(mountContext(input))
    if (typeof mountResult === 'function') {
      cleanup = mountResult
    }

    startResizeObserver(input.root)
    if (disposed) {
      runCleanup()
    } else {
      post({ type: 'mounted' })
    }
  } catch (error) {
    const message = describeError(error)
    input.root.replaceChildren()
    const alert = document.createElement('div')
    alert.setAttribute('role', 'alert')
    alert.textContent = message
    input.root.append(alert)
    post({ type: 'error', message })
  }
}

function startFrame() {
  try {
    const root = rootElement()
    window.addEventListener('message', (event) => handleParentMessage(root, event))
    window.addEventListener('pagehide', () => {
      disposed = true
      runCleanup()
    })
    post({ type: 'ready' })
  } catch (error) {
    post({ type: 'error', message: describeError(error) })
  }
}

startFrame()
