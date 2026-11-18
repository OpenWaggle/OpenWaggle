import type { BrowserPreviewRecordingArtifact } from './browser-preview-controls'

export type BrowserPreviewRecordingRequestAction = 'start' | 'stop'

export interface BrowserPreviewRecordingRequest {
  readonly requestId: string
  readonly previewId: string
  readonly action: BrowserPreviewRecordingRequestAction
}

export interface BrowserPreviewRecordingCancelRequest {
  readonly requestId: string | null
  readonly previewId: string
  readonly reason: 'aborted' | 'preview-closed' | 'timeout'
}

export type BrowserPreviewRecordingRequestResponse =
  | {
      readonly requestId: string
      readonly previewId: string
      readonly status: 'started'
    }
  | {
      readonly requestId: string
      readonly previewId: string
      readonly status: 'stopped'
      readonly artifact: BrowserPreviewRecordingArtifact
    }
  | {
      readonly requestId: string
      readonly previewId: string
      readonly status: 'cancelled'
    }
  | {
      readonly requestId: string
      readonly previewId: string
      readonly status: 'failed'
      readonly error: string
    }
