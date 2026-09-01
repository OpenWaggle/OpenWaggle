import { Schema } from '@shared/schema'
import type {
  InlineVisualizationDownloadInput,
  InlineVisualizationFrameRegisterInput,
  InlineVisualizationFrameTerminateInput,
  InlineVisualizationFrameUnregisterInput,
} from '@shared/types/inline-visualization'

export const inlineVisualizationFrameRegisterInputSchema: Schema.Schema<InlineVisualizationFrameRegisterInput> =
  Schema.Struct({
    frameId: Schema.String,
    sessionId: Schema.String,
    sourcePath: Schema.String,
  })

export const inlineVisualizationDownloadInputSchema: Schema.Schema<InlineVisualizationDownloadInput> =
  Schema.Struct({
    suggestedName: Schema.String,
    mimeType: Schema.String,
    base64Data: Schema.String,
  })

export const inlineVisualizationFrameUnregisterInputSchema: Schema.Schema<InlineVisualizationFrameUnregisterInput> =
  Schema.Struct({
    frameId: Schema.String,
    registrationId: Schema.String,
  })

export const inlineVisualizationFrameTerminateInputSchema: Schema.Schema<InlineVisualizationFrameTerminateInput> =
  inlineVisualizationFrameUnregisterInputSchema
