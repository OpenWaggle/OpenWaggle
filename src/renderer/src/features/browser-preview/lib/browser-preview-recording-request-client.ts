import type { BrowserPreviewRecordingArtifact } from '@shared/types/browser-preview-controls'
import type {
  BrowserPreviewRecordingCancelRequest,
  BrowserPreviewRecordingRequest,
  BrowserPreviewRecordingRequestResponse,
} from '@shared/types/browser-preview-recording-request'

interface RecordingController {
  start(previewId: string): Promise<void>
  stop(): Promise<BrowserPreviewRecordingArtifact | null>
  cancel(): Promise<void>
}

type Respond = (response: BrowserPreviewRecordingRequestResponse) => Promise<void>

const MAX_RESPONSE_ERROR_LENGTH = 1_000

function failureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return (message || 'Browser preview recording failed.').slice(0, MAX_RESPONSE_ERROR_LENGTH)
}

export class BrowserPreviewRecordingRequestClient {
  private pendingRequestId: string | null = null
  private disposed = false

  constructor(
    private readonly previewId: string,
    private readonly controller: RecordingController,
    private readonly respond: Respond,
  ) {}

  async handle(request: BrowserPreviewRecordingRequest): Promise<void> {
    if (this.disposed || request.previewId !== this.previewId) return
    if (this.pendingRequestId !== null) {
      await this.respond({
        requestId: request.requestId,
        previewId: request.previewId,
        status: 'failed',
        error: 'A browser preview recording action is already pending.',
      })
      return
    }
    this.pendingRequestId = request.requestId
    const response = await this.run(request)
    if (this.pendingRequestId !== request.requestId) return
    try {
      await this.respond(response)
    } finally {
      if (this.pendingRequestId === request.requestId) this.pendingRequestId = null
    }
  }

  async cancel(request: BrowserPreviewRecordingCancelRequest): Promise<void> {
    if (request.previewId !== this.previewId) return
    if (request.requestId !== null && request.requestId !== this.pendingRequestId) return
    this.pendingRequestId = null
    await this.controller.cancel()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.pendingRequestId = null
    await this.controller.cancel()
  }

  private async run(
    request: BrowserPreviewRecordingRequest,
  ): Promise<BrowserPreviewRecordingRequestResponse> {
    try {
      if (request.action === 'start') {
        await this.controller.start(request.previewId)
        return { requestId: request.requestId, previewId: request.previewId, status: 'started' }
      }
      const artifact = await this.controller.stop()
      if (artifact === null) throw new Error('Browser preview recording was not active.')
      return {
        requestId: request.requestId,
        previewId: request.previewId,
        status: 'stopped',
        artifact,
      }
    } catch (error) {
      return {
        requestId: request.requestId,
        previewId: request.previewId,
        status: 'failed',
        error: failureMessage(error),
      }
    }
  }
}
