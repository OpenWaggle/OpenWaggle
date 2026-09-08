import { randomUUID } from 'node:crypto'
import type { BrowserPreviewRecordingArtifact } from '@shared/types/browser-preview-controls'
import type {
  BrowserPreviewRecordingCancelRequest,
  BrowserPreviewRecordingRequest,
  BrowserPreviewRecordingRequestAction,
  BrowserPreviewRecordingRequestResponse,
} from '@shared/types/browser-preview-recording-request'
import type { WebContents } from 'electron'
import { browserPreviewAutomationPage } from './browser-preview-automation-page'
import type { BrowserPreviewRecord } from './browser-preview-records'

const MAX_REQUEST_TIMEOUT_MS = 10_000

export interface BrowserPreviewRecordingRequestOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

interface PendingRecordingRequest {
  readonly request: BrowserPreviewRecordingRequest
  readonly record: BrowserPreviewRecord
  readonly resolve: (value: BrowserPreviewRecordingArtifact | undefined) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
  readonly removeAbort: () => void
}

function requestTimeout(options?: BrowserPreviewRecordingRequestOptions) {
  const requested = options?.timeoutMs ?? MAX_REQUEST_TIMEOUT_MS
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new Error('Browser preview recording timeout must be a positive finite number.')
  }
  return Math.min(Math.round(requested), MAX_REQUEST_TIMEOUT_MS)
}

export class BrowserPreviewRecordingRequestBroker {
  private readonly pendingById = new Map<string, PendingRecordingRequest>()
  private readonly pendingByPreview = new Map<string, PendingRecordingRequest>()

  async start(
    record: BrowserPreviewRecord,
    options?: BrowserPreviewRecordingRequestOptions,
  ): Promise<void> {
    const result = await this.request(record, 'start', options)
    if (result !== undefined) throw new Error('Recording start returned an unexpected artifact.')
  }

  async stop(
    record: BrowserPreviewRecord,
    options?: BrowserPreviewRecordingRequestOptions,
  ): Promise<BrowserPreviewRecordingArtifact> {
    const result = await this.request(record, 'stop', options)
    if (result === undefined) throw new Error('Recording stop did not return an artifact.')
    return result
  }

  respond(sender: WebContents, response: BrowserPreviewRecordingRequestResponse): void {
    const pending = this.pendingById.get(response.requestId)
    if (pending === undefined) throw new Error('Browser preview recording request was not found.')
    if (pending.record.owner.sender !== sender || pending.record.previewId !== response.previewId) {
      throw new Error('Browser preview recording response identity did not match its request.')
    }
    this.release(pending)
    if (response.status === 'failed') {
      pending.reject(new Error(response.error))
      return
    }
    if (response.status === 'cancelled') {
      pending.reject(new Error('Browser preview recording request was cancelled.'))
      return
    }
    if (pending.request.action === 'start' && response.status === 'started') {
      pending.resolve(undefined)
      return
    }
    if (
      pending.request.action === 'stop' &&
      response.status === 'stopped' &&
      response.artifact.previewId === pending.record.previewId
    ) {
      pending.resolve(response.artifact)
      return
    }
    pending.reject(new Error('Browser preview recording response did not match its action.'))
  }

  dispose(record: BrowserPreviewRecord): void {
    const pending = this.pendingByPreview.get(browserPreviewAutomationPage(record).tabId)
    this.sendCancel(record, pending?.request.requestId ?? null, 'preview-closed')
    if (pending === undefined) return
    this.release(pending)
    pending.reject(new Error('Browser preview closed during the recording request.'))
  }

  private request(
    record: BrowserPreviewRecord,
    action: BrowserPreviewRecordingRequestAction,
    options?: BrowserPreviewRecordingRequestOptions,
  ): Promise<BrowserPreviewRecordingArtifact | undefined> {
    if (
      record.disposed ||
      record.owner.sender.isDestroyed() ||
      record.view.webContents.isDestroyed()
    ) {
      return Promise.reject(new Error('Browser preview is no longer available for recording.'))
    }
    if (options?.signal?.aborted) {
      return Promise.reject(new Error('Browser preview recording request was aborted.'))
    }
    const previewKey = browserPreviewAutomationPage(record).tabId
    if (this.pendingByPreview.has(previewKey)) {
      return Promise.reject(new Error('A browser preview recording action is already pending.'))
    }
    const request: BrowserPreviewRecordingRequest = {
      requestId: randomUUID(),
      previewId: record.previewId,
      action,
    }
    const timeoutMs = requestTimeout(options)
    return new Promise((resolve, reject) => {
      const abort = () => this.cancelPending(request.requestId, 'aborted')
      options?.signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(() => this.cancelPending(request.requestId, 'timeout'), timeoutMs)
      timer.unref()
      const pending: PendingRecordingRequest = {
        request,
        record,
        resolve,
        reject,
        timer,
        removeAbort: () => options?.signal?.removeEventListener('abort', abort),
      }
      this.pendingById.set(request.requestId, pending)
      this.pendingByPreview.set(previewKey, pending)
      try {
        record.owner.sender.send('browser-preview:recording-request', request)
      } catch (error) {
        this.release(pending)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private cancelPending(
    requestId: string,
    reason: BrowserPreviewRecordingCancelRequest['reason'],
  ): void {
    const pending = this.pendingById.get(requestId)
    if (pending === undefined) return
    this.release(pending)
    this.sendCancel(pending.record, requestId, reason)
    pending.reject(
      new Error(
        reason === 'timeout'
          ? 'Browser preview recording request timed out.'
          : 'Browser preview recording request was aborted.',
      ),
    )
  }

  private sendCancel(
    record: BrowserPreviewRecord,
    requestId: string | null,
    reason: BrowserPreviewRecordingCancelRequest['reason'],
  ): void {
    if (record.owner.sender.isDestroyed()) return
    try {
      record.owner.sender.send('browser-preview:recording-cancel', {
        requestId,
        previewId: record.previewId,
        reason,
      })
    } catch {
      // The request is settled locally even if the renderer disappears before cancellation.
    }
  }

  private release(pending: PendingRecordingRequest): void {
    clearTimeout(pending.timer)
    pending.removeAbort()
    this.pendingById.delete(pending.request.requestId)
    const key = browserPreviewAutomationPage(pending.record).tabId
    if (this.pendingByPreview.get(key) === pending) this.pendingByPreview.delete(key)
  }
}

export const browserPreviewRecordingRequestBroker = new BrowserPreviewRecordingRequestBroker()
