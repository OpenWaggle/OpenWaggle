import { Schema } from '@shared/schema'
import type {
  InlineVisualizationDownloadInput,
  InlineVisualizationFrameRegisterInput,
  InlineVisualizationFrameUnregisterInput,
} from '@shared/types/inline-visualization'

/** Only the requested owner's working-directory fields may authorize a source read. */
export const inlineVisualizationSourceOwnerResultSchema = Schema.NullOr(
  Schema.Struct({
    id: Schema.String,
    projectPath: Schema.NullOr(Schema.String),
    environmentMode: Schema.optional(Schema.Literal('local', 'worktree')),
    worktreePath: Schema.optional(Schema.NullOr(Schema.String)),
  }),
)

export const inlineVisualizationFrameRegisterInputSchema: Schema.Schema<InlineVisualizationFrameRegisterInput> =
  Schema.Struct({
    frameId: Schema.String,
    reducedMotion: Schema.Boolean,
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
