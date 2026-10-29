import { Schema } from '@shared/schema'
import {
  AUTOMATIC_WORKTREE_REMOVAL_DAY_OPTIONS,
  type AutomaticWorktreeRemovalSettings,
  type WorktreeArchiveAndRemovePayload,
} from '@shared/types/worktree-inventory'

/** The saved Automatic worktree removal setting; any other archive age is refused. */
export const automaticWorktreeRemovalSettingsSchema: Schema.Schema<AutomaticWorktreeRemovalSettings> =
  Schema.Struct({
    enabled: Schema.Boolean,
    archivedDays: Schema.Literal(...AUTOMATIC_WORKTREE_REMOVAL_DAY_OPTIONS),
  })

const MAX_WORKTREE_PATH_LENGTH = 4096

export const worktreePathSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(MAX_WORKTREE_PATH_LENGTH),
)

const MAX_RUN_ID_LENGTH = 128
const MAX_SESSION_ID_LENGTH = 128
/** More Sessions than any one worktree holds; a longer list is refused, not truncated. */
const MAX_NAMED_SESSIONS = 1000

export const worktreeArchiveAndRemovePayloadSchema: Schema.Schema<WorktreeArchiveAndRemovePayload> =
  Schema.Struct({
    path: worktreePathSchema,
    sessionIds: Schema.Array(
      Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_SESSION_ID_LENGTH)),
    ).pipe(Schema.maxItems(MAX_NAMED_SESSIONS)),
    force: Schema.optional(Schema.Boolean),
    keepWorktree: Schema.optional(Schema.Boolean),
  })

export const automaticWorktreeRemovalRunIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(MAX_RUN_ID_LENGTH),
)
