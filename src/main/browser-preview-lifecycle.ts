import {
  closeBrowserPreviewRecord,
  hasRequestedBrowserPreviewClose,
} from './browser-preview-explicit-close'
import {
  installBrowserPreviewQuarantinePolicy,
  quarantineBrowserPreviewContents,
} from './browser-preview-quarantine'
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
  private readonly deactivated = new WeakSet<BrowserPreviewRecord>()
  private readonly released = new WeakSet<BrowserPreviewRecord>()

  constructor(private readonly host: BrowserPreviewLifecycleHost) {}

  close(record: BrowserPreviewRecord | undefined): Promise<void> {
    return closeBrowserPreviewRecord(record, (closed) => this.detachDestroyed(closed))
  }

  retire(record: BrowserPreviewRecord): void {
    quarantineBrowserPreviewContents(record.view.webContents)
    attemptCleanup(() => record.view.webContents.setAudioMuted(true))
    attemptCleanup(() => {
      if (record.view.webContents.isDevToolsOpened()) record.view.webContents.closeDevTools()
    })
    this.deactivate(record)
    this.hideAndDetach(record)
    attemptCleanup(() => installBrowserPreviewQuarantinePolicy(record.view.webContents))
    if (hasRequestedBrowserPreviewClose(record)) {
      attemptCleanup(() =>
        record.view.webContents.once('destroyed', () => this.detachDestroyed(record)),
      )
    }
    this.dispose(record, true)
  }

  dispose(record: BrowserPreviewRecord, detached = false): void {
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
    if (!detached) this.hideAndDetach(record)
    attemptCleanup(() => {
      if (!record.view.webContents.isDestroyed()) record.view.webContents.close()
    })
  }

  private hideAndDetach(record: BrowserPreviewRecord) {
    record.bounds = null
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
