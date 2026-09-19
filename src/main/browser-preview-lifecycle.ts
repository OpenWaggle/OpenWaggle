import { closeBrowserPreviewRecord } from './browser-preview-explicit-close'
import { closeBrowserPreviewContents } from './browser-preview-native-close'
import {
  installBrowserPreviewQuarantinePolicy,
  quarantineBrowserPreviewContents,
} from './browser-preview-quarantine'
import type { BrowserPreviewRecord } from './browser-preview-records'
import { BrowserPreviewRetirementCleanup } from './browser-preview-retirement-cleanup'

function attemptCleanup(action: () => void) {
  try {
    action()
  } catch {
    // Continue releasing the remaining native resources after an Electron teardown race.
  }
}

export interface BrowserPreviewLifecycleHost {
  readonly disposeControls: (record: BrowserPreviewRecord) => void
  readonly removeRecord: (record: BrowserPreviewRecord) => void
}

export class BrowserPreviewLifecycle {
  private readonly deactivated = new WeakSet<BrowserPreviewRecord>()
  private readonly released = new WeakSet<BrowserPreviewRecord>()
  private readonly retired = new WeakSet<BrowserPreviewRecord>()
  private readonly detached = new WeakSet<BrowserPreviewRecord>()
  private readonly retirementCleanup = new BrowserPreviewRetirementCleanup((record) =>
    this.close(record),
  )

  constructor(private readonly host: BrowserPreviewLifecycleHost) {}

  close(record: BrowserPreviewRecord | undefined): Promise<void> {
    return closeBrowserPreviewRecord(record, (closed) => this.detachDestroyed(closed))
  }

  retire(record: BrowserPreviewRecord): void {
    if (this.retired.has(record) || this.released.has(record)) return
    this.retired.add(record)
    quarantineBrowserPreviewContents(record.view.webContents)
    attemptCleanup(() => record.view.webContents.setAudioMuted(true))
    attemptCleanup(() => {
      if (record.view.webContents.isDevToolsOpened()) record.view.webContents.closeDevTools()
    })
    this.deactivate(record)
    this.hideAndDetach(record)
    attemptCleanup(() => installBrowserPreviewQuarantinePolicy(record.view.webContents))
    attemptCleanup(() =>
      record.view.webContents.once('destroyed', () => this.detachDestroyed(record)),
    )
    this.retirementCleanup.start(record)
  }

  dispose(record: BrowserPreviewRecord): void {
    this.detach(record)
    attemptCleanup(() => {
      if (!record.view.webContents.isDestroyed()) record.view.webContents.close()
    })
  }

  disposeAndWait(record: BrowserPreviewRecord): Promise<void> {
    this.detach(record)
    return closeBrowserPreviewContents(record.view.webContents)
  }

  private detach(record: BrowserPreviewRecord): void {
    if (!this.release(record)) return
    attemptCleanup(() => {
      if (!record.owner.window.isDestroyed()) record.view.setVisible(false)
    })
    attemptCleanup(() => {
      if (!record.owner.window.isDestroyed()) {
        record.owner.window.contentView.removeChildView(record.view)
      }
    })
  }

  private hideAndDetach(record: BrowserPreviewRecord) {
    record.bounds = null
    attemptCleanup(() => {
      if (!record.owner.window.isDestroyed()) record.view.setVisible(false)
    })
    this.detachView(record)
  }

  private detachView(record: BrowserPreviewRecord) {
    if (this.detached.has(record)) return
    attemptCleanup(() => {
      if (!record.owner.window.isDestroyed()) {
        record.owner.window.contentView.removeChildView(record.view)
      }
      this.detached.add(record)
    })
  }

  detachDestroyed(record: BrowserPreviewRecord): void {
    this.retirementCleanup.cancel(record)
    if (!this.release(record)) return
    this.detachView(record)
  }

  private release(record: BrowserPreviewRecord) {
    if (this.released.has(record)) return false
    this.released.add(record)
    this.deactivate(record)
    attemptCleanup(() => this.host.removeRecord(record))
    return true
  }

  private deactivate(record: BrowserPreviewRecord) {
    if (this.deactivated.has(record)) return
    this.deactivated.add(record)
    record.disposed = true
    attemptCleanup(() => this.host.disposeControls(record))
    for (const removeListener of record.removeListeners.splice(0)) attemptCleanup(removeListener)
  }
}
