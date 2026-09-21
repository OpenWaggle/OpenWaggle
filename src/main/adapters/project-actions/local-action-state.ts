import { decodeUnknownExactOrThrow, parseJsonUnknown, Schema } from '@shared/schema'
import { actionManifestSchema, preparationReviewSchema } from '@shared/schemas/action-definitions'
import type { LocalActionState } from '../../domain/project-action-catalog'

export const localActionDocumentSchema = Schema.Struct({
  manifest: actionManifestSchema,
  reviews: Schema.Array(preparationReviewSchema),
  migration: Schema.Struct({
    version: Schema.Literal(1),
    legacySource: Schema.NullOr(Schema.String),
  }),
})
export const localActionStateSchema = Schema.Struct({
  document: localActionDocumentSchema,
  pending: Schema.NullOr(
    Schema.Struct({
      workspacePath: Schema.String,
      workspaceIdentity: Schema.optional(
        Schema.Struct({
          device: Schema.String,
          inode: Schema.String,
          birthtime: Schema.String,
          resourceId: Schema.NullOr(Schema.String),
        }),
      ),
      previousSharedRevision: Schema.String,
      nextShared: actionManifestSchema,
      nextLocal: localActionDocumentSchema,
    }),
  ),
})

export interface StoredActionState {
  readonly revision: number
  readonly state: LocalActionState
}

export interface ActionStatePersistence {
  readonly readWorkspace: (
    projectPath: string,
    workspacePath: string,
  ) => Promise<{ readonly id: string; readonly ready: boolean } | null>
  readonly read: (projectPath: string) => Promise<StoredActionState | null>
  readonly write: (
    projectPath: string,
    expectedRevision: number,
    state: LocalActionState,
  ) => Promise<StoredActionState>
}

export function decodeLocalActionState(raw: string): LocalActionState {
  return decodeUnknownExactOrThrow(localActionStateSchema, parseJsonUnknown(raw))
}
