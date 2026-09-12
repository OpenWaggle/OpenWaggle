import { isBrowserPreviewUrl, normalizeBrowserPreviewUrl } from '@shared/schemas/browser-preview'
import type { BrowserPreviewState } from '@shared/types/browser-preview'
import { monitorBrowserPreview } from './browser-preview-events'
import { sendBrowserPreviewOwnerEvent } from './browser-preview-owner-events'
import {
  boundedBrowserPreviewText,
  browserPreviewStateError,
  MAX_TITLE_LENGTH,
} from './browser-preview-policy'
import type { BrowserPreviewRecord } from './browser-preview-records'

interface BrowserPreviewNavigationHost {
  readonly detachDestroyed: (record: BrowserPreviewRecord) => void
  readonly dispose: (record: BrowserPreviewRecord) => void
  readonly emitState: (record: BrowserPreviewRecord) => void
}

export interface BrowserPreviewLoadOperation {
  readonly generation: number
  readonly completion: Promise<void>
  readonly isCurrent: () => boolean
  readonly stop: () => void
}

export class BrowserPreviewNavigation {
  constructor(private readonly host: BrowserPreviewNavigationHost) {}

  navigate(record: BrowserPreviewRecord, canonicalUrl: string): BrowserPreviewState {
    if (record.state.url === canonicalUrl) return this.snapshot(record)
    record.state = {
      ...record.state,
      url: canonicalUrl,
      title: '',
      loading: true,
      error: null,
    }
    this.host.emitState(record)
    this.loadUrl(record, canonicalUrl)
    return record.state
  }

  goBack(record: BrowserPreviewRecord): BrowserPreviewState {
    if (record.view.webContents.navigationHistory.canGoBack()) {
      record.loadGeneration += 1
      record.state = { ...record.state, loading: true, error: null }
      record.view.webContents.navigationHistory.goBack()
      this.host.emitState(record)
    }
    return record.state
  }

  goForward(record: BrowserPreviewRecord): BrowserPreviewState {
    if (record.view.webContents.navigationHistory.canGoForward()) {
      record.loadGeneration += 1
      record.state = { ...record.state, loading: true, error: null }
      record.view.webContents.navigationHistory.goForward()
      this.host.emitState(record)
    }
    return record.state
  }

  reload(record: BrowserPreviewRecord): BrowserPreviewState {
    record.loadGeneration += 1
    record.state = { ...record.state, loading: true, error: null }
    record.view.webContents.reload()
    this.host.emitState(record)
    return record.state
  }

  stop(record: BrowserPreviewRecord): BrowserPreviewState {
    record.loadGeneration += 1
    record.view.webContents.stop()
    record.state = { ...record.state, loading: false }
    this.host.emitState(record)
    return this.snapshot(record)
  }

  loadUrl(record: BrowserPreviewRecord, canonicalUrl: string): void {
    const operation = this.beginLoad(record, canonicalUrl)
    void operation.completion.catch(() => undefined)
  }

  beginAutomationNavigation(
    record: BrowserPreviewRecord,
    canonicalUrl: string,
  ): BrowserPreviewLoadOperation {
    record.state = {
      ...record.state,
      url: canonicalUrl,
      title: record.state.url === canonicalUrl ? record.state.title : '',
      loading: true,
      error: null,
    }
    this.host.emitState(record)
    const operation = this.beginLoad(record, canonicalUrl)
    return {
      ...operation,
      isCurrent: () => !record.disposed && operation.generation === record.loadGeneration,
      stop: () => {
        if (!record.disposed && operation.generation === record.loadGeneration) this.stop(record)
      },
    }
  }

  private beginLoad(record: BrowserPreviewRecord, canonicalUrl: string) {
    record.loadGeneration += 1
    const generation = record.loadGeneration
    const completion = record.view.webContents.loadURL(canonicalUrl)
    void completion.catch((cause: unknown) => {
      if (record.disposed || generation !== record.loadGeneration) return
      const description = cause instanceof Error ? cause.message : String(cause)
      if (description.includes('ERR_ABORTED')) return
      record.state = {
        ...record.state,
        loading: false,
        error: browserPreviewStateError('LOAD_FAILED', description, canonicalUrl),
      }
      this.host.emitState(record)
    })
    return { generation, completion }
  }

  snapshot(record: BrowserPreviewRecord): BrowserPreviewState {
    if (record.disposed || record.view.webContents.isDestroyed()) return record.state
    const contents = record.view.webContents
    const actualUrl = contents.getURL()
    record.state = {
      ...record.state,
      url: isBrowserPreviewUrl(actualUrl)
        ? normalizeBrowserPreviewUrl(actualUrl)
        : record.state.url,
      title: boundedBrowserPreviewText(contents.getTitle(), MAX_TITLE_LENGTH),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
    }
    return record.state
  }

  monitor(record: BrowserPreviewRecord): void {
    monitorBrowserPreview(record, {
      snapshot: () => this.snapshot(record),
      emitState: () => this.host.emitState(record),
      emitShortcut: (action) =>
        sendBrowserPreviewOwnerEvent(record, {
          channel: 'browser-preview:shortcut',
          payload: { previewId: record.previewId, action },
          focusOwner: true,
        }),
      emitKeyEvent: (event) =>
        sendBrowserPreviewOwnerEvent(record, {
          channel: 'browser-preview:key-event',
          payload: event,
        }),
      navigate: (url) => {
        this.navigate(record, url)
      },
      reload: () => {
        this.reload(record)
      },
      goBack: () => {
        this.goBack(record)
      },
      goForward: () => {
        this.goForward(record)
      },
      dispose: () => this.host.dispose(record),
      detachDestroyed: () => this.host.detachDestroyed(record),
    })
  }
}
