import { closeBrowserPreviewContents } from './browser-preview-native-close'
import type { BrowserPreviewRecord } from './browser-preview-records'

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
  constructor(private readonly host: BrowserPreviewLifecycleHost) {}

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

  detachDestroyed(record: BrowserPreviewRecord): void {
    if (!this.release(record)) return
    attemptCleanup(() => {
      if (!record.owner.window.isDestroyed()) {
        record.owner.window.contentView.removeChildView(record.view)
      }
    })
  }

  private release(record: BrowserPreviewRecord) {
    if (record.disposed) return false
    record.disposed = true
    attemptCleanup(() => this.host.disposeControls(record))
    attemptCleanup(() => this.host.removeRecord(record))
    for (const removeListener of record.removeListeners.splice(0)) attemptCleanup(removeListener)
    return true
  }
}
