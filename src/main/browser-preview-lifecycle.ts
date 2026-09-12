import {
  closeBrowserPreviewRecord,
  hasRequestedBrowserPreviewClose,
} from './browser-preview-explicit-close'
import type { BrowserPreviewRecord } from './browser-preview-records'
import { createLogger } from './logger'

const logger = createLogger('browser-preview-lifecycle')

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

  close(record: BrowserPreviewRecord | undefined): Promise<void> {
    return closeBrowserPreviewRecord(record, (closed) => this.detachDestroyed(closed))
  }

  dispose(record: BrowserPreviewRecord): void {
    if (hasRequestedBrowserPreviewClose(record)) {
      void this.close(record).catch((error: unknown) => {
        logger.warn('Native preview close failed during owner cleanup', {
          previewId: record.previewId,
          error,
        })
      })
      return
    }
    if (!this.release(record)) return
    attemptCleanup(() => {
      if (!record.owner.window.isDestroyed()) record.view.setVisible(false)
    })
    attemptCleanup(() => {
      if (!record.owner.window.isDestroyed()) {
        record.owner.window.contentView.removeChildView(record.view)
      }
    })
    attemptCleanup(() => {
      if (!record.view.webContents.isDestroyed()) record.view.webContents.close()
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
