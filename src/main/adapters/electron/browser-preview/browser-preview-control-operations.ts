import type { BrowserPreviewAppearance } from '@shared/types/browser-preview-controls'
import type { WebContents } from 'electron'
import {
  type BrowserPreviewAutomationPage,
  browserPreviewAutomationController,
} from './browser-preview-automation-control'
import type { CdpCommandParams } from './browser-preview-cdp-input-params'

type ControlledWebContents = WebContents

interface BrowserPreviewControlBroker {
  readonly sendControl: (
    page: BrowserPreviewAutomationPage,
    method: string,
    params?: CdpCommandParams,
  ) => Promise<unknown>
  readonly releaseForDevTools: (tabId: string) => void
}

export class BrowserPreviewControlOperations {
  private readonly appearanceByTabId = new Map<string, BrowserPreviewAppearance>()

  private readonly broker: BrowserPreviewControlBroker

  constructor(broker: BrowserPreviewControlBroker = browserPreviewAutomationController) {
    this.broker = broker
  }

  register(tabId: string, contents: ControlledWebContents, appearance: BrowserPreviewAppearance) {
    this.appearanceByTabId.set(tabId, appearance)
    return this.applyAppearance(tabId, contents, appearance)
  }

  hardReload(contents: ControlledWebContents) {
    contents.reloadIgnoringCache()
  }

  async setAppearance(
    tabId: string,
    contents: ControlledWebContents,
    appearance: BrowserPreviewAppearance,
  ) {
    this.appearanceByTabId.set(tabId, appearance)
    await this.applyAppearance(tabId, contents, appearance)
  }

  async openDevTools(tabId: string, contents: ControlledWebContents) {
    if (contents.isDevToolsOpened()) {
      contents.devToolsWebContents?.focus()
      return
    }
    this.broker.releaseForDevTools(tabId)
    contents.once('devtools-closed', () => {
      const appearance = this.appearanceByTabId.get(tabId)
      if (appearance === undefined || contents.isDestroyed()) return
      void this.applyAppearance(tabId, contents, appearance).catch(() => undefined)
    })
    contents.openDevTools({ mode: 'detach' })
  }

  async clearCookies(contents: ControlledWebContents) {
    await contents.session.clearStorageData({ storages: ['cookies'] })
  }

  async clearCache(contents: ControlledWebContents) {
    await contents.session.clearCache()
  }

  dispose(tabId: string) {
    this.appearanceByTabId.delete(tabId)
    this.broker.releaseForDevTools(tabId)
  }

  private async applyAppearance(
    tabId: string,
    contents: ControlledWebContents,
    appearance: BrowserPreviewAppearance,
  ) {
    if (contents.isDestroyed() || contents.isDevToolsOpened()) return
    await this.broker.sendControl({ tabId, contents }, 'Emulation.setEmulatedMedia', {
      features: [
        {
          name: 'prefers-color-scheme',
          value: appearance === 'system' ? '' : appearance,
        },
      ],
    })
  }
}
