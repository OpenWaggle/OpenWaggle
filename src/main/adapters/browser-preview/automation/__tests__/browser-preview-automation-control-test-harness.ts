import { uncheckedFields } from '@shared/utils/object-shape'
import { EventEmitter } from 'node:events'
import { fromPartial } from '@total-typescript/shoehorn'
import type {
  BrowserPreviewAutomationContents,
  BrowserPreviewAutomationDebugger,
} from '../browser-preview-automation-contents'
import { vi } from 'vitest'
import type { CdpCommandParams } from '../browser-preview-cdp-input-params'

export function createBrowserPreviewAutomationPageFixture(
  options: { readonly attached?: boolean; readonly devToolsOpen?: boolean } = {},
) {
  const contentsEvents = new EventEmitter()
  const debuggerEvents = new EventEmitter()
  let attached = options.attached ?? false
  let devToolsOpen = options.devToolsOpen ?? false
  let destroyed = false
  const sendCommand = vi.fn(async (method: string, params?: CdpCommandParams) => {
    if (method !== 'Runtime.evaluate') return {}
    const expression = uncheckedFields<{ expression: string }>(params).expression
    if (expression === 'answer') return { result: { value: 42 } }
    if (expression === 'Boolean(globalThis.__openWagglePlaywrightInjected)') {
      return { result: { value: true } }
    }
    return { result: { value: null } }
  })
  const browserDebugger = fromPartial<BrowserPreviewAutomationDebugger>({
    on: debuggerEvents.on.bind(debuggerEvents),
    removeListener: debuggerEvents.removeListener.bind(debuggerEvents),
    attach: vi.fn(() => {
      attached = true
    }),
    detach: vi.fn(() => {
      attached = false
    }),
    isAttached: () => attached,
    sendCommand,
  })
  const contents = fromPartial<BrowserPreviewAutomationContents>({
    id: 1,
    debugger: browserDebugger,
    isDevToolsOpened: () => devToolsOpen,
    getBackgroundThrottling: () => true,
    isDestroyed: () => destroyed,
    on: contentsEvents.on.bind(contentsEvents),
    once: contentsEvents.once.bind(contentsEvents),
    removeListener: contentsEvents.removeListener.bind(contentsEvents),
    setBackgroundThrottling: vi.fn(),
  })
  return {
    page: { tabId: 'tab-1', contents },
    browserDebugger,
    contentsEvents,
    debuggerEvents,
    sendCommand,
    destroy() {
      destroyed = true
      contentsEvents.emit('destroyed')
    },
    openDevTools() {
      devToolsOpen = true
    },
    setDebuggerAttached(value: boolean) {
      attached = value
    },
  }
}
