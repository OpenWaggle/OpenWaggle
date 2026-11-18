import type {
  BrowserPreviewRecordingArtifact,
  BrowserPreviewRecordingGrant,
  BrowserPreviewRecordingMimeType,
  BrowserPreviewRecordingSaveInput,
} from '@shared/types/browser-preview-controls'

export type BrowserPreviewRecordingPhase = 'idle' | 'starting' | 'recording' | 'stopping' | 'error'

export interface BrowserPreviewRecordingSnapshot {
  readonly phase: BrowserPreviewRecordingPhase
  readonly previewId: string | null
  readonly bytes: number
  readonly artifact: BrowserPreviewRecordingArtifact | null
  readonly error: string | null
}

export interface BrowserPreviewRecordingOperations {
  begin(previewId: string): Promise<BrowserPreviewRecordingGrant>
  save(input: BrowserPreviewRecordingSaveInput): Promise<BrowserPreviewRecordingArtifact>
  finish(previewId: string): Promise<void>
}

export interface BrowserPreviewRecordingEnvironment {
  readonly getDisplayMedia: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>
  readonly createMediaRecorder: (
    stream: MediaStream,
    options: MediaRecorderOptions,
  ) => MediaRecorder
  readonly isTypeSupported: (mimeType: string) => boolean
  readonly now: () => number
  readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void
}

export interface BrowserPreviewRecordingSession {
  readonly previewId: string
  readonly recorder: MediaRecorder
  readonly stream: MediaStream
  readonly mimeType: BrowserPreviewRecordingMimeType
  readonly maxBytes: number
  readonly maxDurationMs: number
  readonly startedAt: number
  readonly chunks: Blob[]
  readonly completion: Promise<BrowserPreviewRecordingArtifact | null>
  readonly resolve: (artifact: BrowserPreviewRecordingArtifact | null) => void
  readonly reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout> | null
  bytes: number
  finalized: boolean
}
