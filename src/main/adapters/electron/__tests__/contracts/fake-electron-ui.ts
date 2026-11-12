import type { NotificationConstructorOptions } from 'electron'
import { EventEmitter } from 'node:events'

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]

export class FakeNativeImage {
  readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }
  isEmpty() {
    return !PNG_SIGNATURE.every((byte, index) => this.bytes[index] === byte)
  }
}

export interface FakeMenuItem {
  readonly label?: string
  readonly click?: () => void
}

export class FakeMenu {
  static applicationMenu: FakeMenu | null = null
  readonly popups: unknown[] = []
  readonly template: readonly FakeMenuItem[]

  constructor(template: readonly FakeMenuItem[]) {
    this.template = template
  }
  static buildFromTemplate(template: readonly FakeMenuItem[]) {
    return new FakeMenu(template)
  }
  static setApplicationMenu(menu: FakeMenu | null) {
    FakeMenu.applicationMenu = menu
  }
  popup(options: unknown) {
    this.popups.push(options)
    lastPopup.current = { menu: this, options }
  }
}

export const lastPopup: { current: { readonly menu: FakeMenu; readonly options: unknown } | null } =
  {
    current: null,
  }

export class FakeNotification extends EventEmitter {
  static supported = true
  static readonly shown: FakeNotification[] = []
  static readonly removed: string[] = []
  closed = false
  readonly options: NotificationConstructorOptions

  constructor(options: NotificationConstructorOptions) {
    super()
    this.options = options
  }
  static isSupported() {
    return FakeNotification.supported
  }
  static remove(id: string) {
    FakeNotification.removed.push(id)
  }
  show() {
    FakeNotification.shown.push(this)
    this.emit('show')
  }
  close() {
    this.closed = true
  }
}

/** electron-updater's `autoUpdater`, offering whatever the test puts on the feed. */
export class FakeAppUpdater extends EventEmitter {
  channel: string | null = null
  allowPrerelease = false
  allowDowngrade = true
  logger: unknown = console
  autoDownload = true
  autoInstallOnAppQuit = true
  offered: string | null = null
  downloadCancelled = false
  readonly installs: { readonly silent: boolean; readonly relaunch: boolean }[] = []

  setFeedURL() {}
  checkForUpdates() {
    const version = this.offered
    if (version === null) {
      return Promise.resolve({ isUpdateAvailable: false, updateInfo: { version: '1.0.0-fake' } })
    }
    return Promise.resolve({
      isUpdateAvailable: true,
      updateInfo: { version },
      downloadPromise: null,
      cancellationToken: { cancel: () => void (this.downloadCancelled = true) },
    })
  }
  quitAndInstall(silent = false, relaunch = false) {
    this.installs.push({ silent, relaunch })
  }
}

export function fakeElectronUpdater() {
  const autoUpdater = new FakeAppUpdater()
  return { module: { autoUpdater }, autoUpdater }
}
