import { Schema } from '@shared/schema'
import {
  BROWSER_PREVIEW_CAPTURE_LIMITS,
  BROWSER_PREVIEW_RECORDING_MIME_TYPES,
} from '@shared/types/browser-preview-controls'
import type { BrowserPreviewRecordingRequestResponse } from '@shared/types/browser-preview-recording-request'
import { browserPreviewArtifactPathSchema, browserPreviewIdSchema } from './browser-preview'

const MAX_REQUEST_ID_LENGTH = 128
const MAX_ARTIFACT_ID_LENGTH = 128
const MAX_TIMESTAMP_LENGTH = 64
const MAX_ERROR_LENGTH = 1_000

const requestIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(MAX_REQUEST_ID_LENGTH),
)
const recordingArtifactSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_ARTIFACT_ID_LENGTH)),
  previewId: browserPreviewIdSchema,
  path: browserPreviewArtifactPathSchema,
  mimeType: Schema.Literal(...BROWSER_PREVIEW_RECORDING_MIME_TYPES),
  sizeBytes: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThan(0),
    Schema.lessThanOrEqualTo(BROWSER_PREVIEW_CAPTURE_LIMITS.RECORDING_BYTES),
  ),
  durationMs: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThan(0),
    Schema.lessThanOrEqualTo(BROWSER_PREVIEW_CAPTURE_LIMITS.RECORDING_DURATION_MS),
  ),
  createdAt: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_TIMESTAMP_LENGTH)),
})

export const browserPreviewRecordingRequestResponseSchema: Schema.Schema<BrowserPreviewRecordingRequestResponse> =
  Schema.Union(
    Schema.Struct({
      requestId: requestIdSchema,
      previewId: browserPreviewIdSchema,
      status: Schema.Literal('started'),
    }),
    Schema.Struct({
      requestId: requestIdSchema,
      previewId: browserPreviewIdSchema,
      status: Schema.Literal('stopped'),
      artifact: recordingArtifactSchema,
    }),
    Schema.Struct({
      requestId: requestIdSchema,
      previewId: browserPreviewIdSchema,
      status: Schema.Literal('cancelled'),
    }),
    Schema.Struct({
      requestId: requestIdSchema,
      previewId: browserPreviewIdSchema,
      status: Schema.Literal('failed'),
      error: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_ERROR_LENGTH)),
    }),
  )
