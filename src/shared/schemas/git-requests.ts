/**
 * The request objects the window passes to the `git:*` IPC channels. Each schema is the one
 * source of its payload: `@shared/types/git` and `@shared/types/vcs` export the inferred types,
 * and the main handlers decode with these schemas.
 */
import { BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import { Schema } from '@shared/schema'
import { SessionId } from '@shared/types/brand'
import { GIT_STACKED_ACTIONS } from '@shared/types/vcs'

/** Maximum number of selected files accepted by one commit IPC request. */
export const GIT_SELECTED_PATH_COUNT_LIMIT = 10_000
/** Maximum UTF-8 bytes, including NUL separators, accepted for selected commit paths. */
export const GIT_SELECTED_PATH_BYTE_LIMIT = 4 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE

const textEncoder = new TextEncoder()

/** UTF-8 bytes of the paths with their NUL separators; stops counting past the limit. */
export function selectedGitPathsByteLength(paths: readonly string[]) {
  let bytes = 0
  for (const gitPath of paths) {
    bytes += textEncoder.encode(gitPath).byteLength + 1
    if (bytes > GIT_SELECTED_PATH_BYTE_LIMIT) return bytes
  }
  return bytes
}

const selectedGitPathSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter((gitPath) => !gitPath.includes('\0') || 'Git paths cannot contain NUL bytes.'),
)

/** Shared by both renderer-accessible commit entry points. */
export const selectedGitPathsSchema = Schema.Array(selectedGitPathSchema).pipe(
  Schema.maxItems(GIT_SELECTED_PATH_COUNT_LIMIT),
  Schema.filter(
    (paths) =>
      selectedGitPathsByteLength(paths) <= GIT_SELECTED_PATH_BYTE_LIMIT ||
      `Selected Git paths exceed the ${String(GIT_SELECTED_PATH_BYTE_LIMIT)} byte limit.`,
  ),
)

const gitSessionIdSchema = Schema.String.pipe(Schema.fromBrand(SessionId))

export const gitCommitPayloadSchema = Schema.Struct({
  /** Originating Session, used by main to verify ownership and project the commit into Outputs. */
  sessionId: Schema.optional(gitSessionIdSchema),
  message: Schema.String,
  amend: Schema.Boolean,
  paths: selectedGitPathsSchema,
  /** False commits the existing index without staging working-tree changes. Defaults to true. */
  includeUnstaged: Schema.optional(Schema.Boolean),
})

export const gitRunStackedActionOptionsSchema = Schema.Struct({
  action: Schema.Literal(...GIT_STACKED_ACTIONS),
  /** Renderer-generated id used to scope progress and cancellation to this invocation. */
  operationId: Schema.optional(Schema.String),
  /** Session that initiated the action, used only to project created outputs. */
  sessionId: Schema.optional(gitSessionIdSchema),
  commitMessage: Schema.optional(Schema.String),
  createFeatureBranch: Schema.optional(Schema.Boolean),
  featureBranchName: Schema.optional(Schema.String),
  /** Preserve a validated user-entered ref verbatim instead of auto-sanitizing or suffixing it. */
  exactFeatureBranchName: Schema.optional(Schema.Boolean),
  baseRef: Schema.optional(Schema.String),
  changeRequestTitle: Schema.optional(Schema.String),
  changeRequestBody: Schema.optional(Schema.String),
  draft: Schema.optional(Schema.Boolean),
  /**
   * Repo-relative paths to stage for the commit phase.
   *
   * Required in practice: an empty or omitted selection reports `nothing-to-commit` rather than
   * staging the whole repository. `git add --all` has no pathspec, so the old fallback reached
   * past the opened directory and swept the user's unrelated in-flight work into the commit.
   */
  paths: Schema.optional(selectedGitPathsSchema),
  /** False commits only the existing index and leaves unstaged changes untouched. */
  includeUnstaged: Schema.optional(Schema.Boolean),
})

export const gitBranchCheckoutPayloadSchema = Schema.Struct({ name: Schema.String })

export const gitBranchCreatePayloadSchema = Schema.Struct({
  name: Schema.String,
  startPoint: Schema.optional(Schema.String),
  checkout: Schema.optional(Schema.Boolean),
})

export const gitWorktreeCreatePayloadSchema = Schema.Struct({
  /** Absolute path where the worktree checkout is created. */
  path: Schema.String,
  /** Temporary branch created for the worktree (git worktree add -b). */
  branch: Schema.String,
  /** Base ref the worktree branch starts from. */
  baseRef: Schema.String,
  /**
   * Set when the worktree belongs to a session, so main decides the branch name rather than the
   * caller.
   *
   * Session branches follow a convention with a legacy form, and a caller deriving the current name
   * itself missed it: recreating an older session's tree created a fresh branch at the base ref and
   * left the agent's commits stranded on the old one.
   */
  sessionId: Schema.optionalWith(Schema.String, { exact: true }),
})

/** The main handler also requires `path` to be absolute, which only Node checks. */
export const gitWorktreeRemovePayloadSchema = Schema.Struct({
  /** Explicitly bypass a failed or review-blocked cleanup. */
  skipCleanup: Schema.optionalWith(Schema.Boolean, { exact: true }),
  path: Schema.String.pipe(Schema.minLength(1)),
  /** Only pass true on explicit user request; this can discard dirty or locked worktrees. */
  force: Schema.optionalWith(Schema.Boolean, { exact: true }),
  /**
   * With `force`, override only Git's lock: a worktree with uncommitted changes, or whose
   * changes Git cannot report, is still refused. Git itself has no such flag.
   */
  lockOnly: Schema.optionalWith(Schema.Boolean, { exact: true }),
})

/**
 * A Change request the window asks to open. The fork-safe head identity
 * (`OpenChangeRequestPayload.headOwner` and `headRepository`) is main's to resolve, so the
 * window cannot send it.
 */
export const changeRequestPreflightPayloadSchema = Schema.Struct({
  headRef: Schema.String,
  /** Omitted when the provider should use its configured default branch. */
  baseRef: Schema.optional(Schema.String),
  title: Schema.String,
  body: Schema.optional(Schema.String),
  draft: Schema.optional(Schema.Boolean),
  createFeatureBranch: Schema.optional(Schema.Boolean),
})
