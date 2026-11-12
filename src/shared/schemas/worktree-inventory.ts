import { Schema } from '@shared/schema'
import { AUTOMATIC_WORKTREE_REMOVAL_DAY_OPTIONS } from '@shared/types/worktree-inventory'

/** The saved Automatic worktree removal setting; any other archive age is refused. */
export const automaticWorktreeRemovalSettingsSchema = Schema.Struct({
  enabled: Schema.Boolean,
  /** How long every Session bound to a worktree has been archived before it is removed. */
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

/** `worktrees:archive-and-remove`: archive every Session working in it, then remove it. */
export const worktreeArchiveAndRemovePayloadSchema = Schema.Struct({
  path: worktreePathSchema,
  /**
   * Every Session the confirmation named. The Host refuses when the Sessions working in the
   * worktree have changed since, so it never archives one the user was not shown.
   */
  sessionIds: Schema.Array(
    Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_SESSION_ID_LENGTH)),
  ).pipe(Schema.maxItems(MAX_NAMED_SESSIONS)),
  /** Override Git's lock. Uncommitted changes always keep the worktree: this never discards. */
  force: Schema.optional(Schema.Boolean),
  /**
   * Archive the Sessions and stop there ("Archive Sessions", for a worktree that may have
   * changes): the worktree is kept whatever its state, for an explicit decision later.
   */
  keepWorktree: Schema.optional(Schema.Boolean),
})

export const automaticWorktreeRemovalRunIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(MAX_RUN_ID_LENGTH),
)
