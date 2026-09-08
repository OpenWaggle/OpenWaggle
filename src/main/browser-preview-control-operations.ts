import type { BrowserPreviewAppearance } from '@shared/types/browser-preview-controls'
import type { WebContents } from 'electron'
import {
  type BrowserPreviewAutomationPage,
  browserPreviewAutomationController,
} from './browser-preview-automation-control'

type ControlledWebContents = WebContents

interface BrowserPreviewControlBroker {
  readonly sendControl: (
    page: BrowserPreviewAutomationPage,
    method: string,
    params?: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>
  readonly releaseForDevTools: (tabId: string) => void
}

export class BrowserPreviewControlOperations {
  private readonly appearanceByTabId = new Map<string, BrowserPreviewAppearance>()

  constructor(
    private readonly broker: BrowserPreviewControlBroker = browserPreviewAutomationController,
  ) {}

  register(
    tabId: string,
    contents: ControlledWebContents,
    appearance: BrowserPreviewAppearance,
  ): Promise<void> {
    this.appearanceByTabId.set(tabId, appearance)
    return this.applyAppearance(tabId, contents, appearance)
  }

  hardReload(contents: ControlledWebContents): void {
    contents.reloadIgnoringCache()
  }

  async setAppearance(
    tabId: string,
    contents: ControlledWebContents,
    appearance: BrowserPreviewAppearance,
  ): Promise<void> {
    this.appearanceByTabId.set(tabId, appearance)
    await this.applyAppearance(tabId, contents, appearance)
  }

  async openDevTools(tabId: string, contents: ControlledWebContents): Promise<void> {
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

  async clearCookies(contents: ControlledWebContents): Promise<void> {
    await contents.session.clearStorageData({ storages: ['cookies'] })
  }

  async clearCache(contents: ControlledWebContents): Promise<void> {
    await contents.session.clearCache()
  }

  dispose(tabId: string): void {
    this.appearanceByTabId.delete(tabId)
    this.broker.releaseForDevTools(tabId)
  }

  private async applyAppearance(
    tabId: string,
    contents: ControlledWebContents,
    appearance: BrowserPreviewAppearance,
  ): Promise<void> {
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
