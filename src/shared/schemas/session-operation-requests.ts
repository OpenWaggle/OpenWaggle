/**
 * The request objects and ids the desktop window passes to the `sessions:*` IPC channels.
 *
 * Each schema is the one source of its payload: `@shared/types/session` exports the types
 * inferred from them, and the Host's Session operations decode the channel arguments with them.
 * The messages name the id or field that is refused, as the hand-written validators did.
 */
import { Schema } from '@shared/schema'
import { isSessionInputTextWithinLimit, SESSION_INPUT_LIMITS } from '@shared/session-input-limits'
import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import { SESSION_ENVIRONMENT_MODES } from '@shared/types/git'

/** A non-blank id within the Session input limit, refused with `label` in the message. */
function sessionOperationIdSchema(label: string) {
  const blank = `${label} must be a non-empty string.`
  return Schema.String.annotations({ message: () => blank }).pipe(
    Schema.filter((value) => value.trim().length > 0 || blank),
    Schema.filter(
      (value) =>
        value.length <= SESSION_INPUT_LIMITS.idLength || `${label} exceeds the input limit.`,
    ),
  )
}

export const sessionOperationSessionIdSchema = sessionOperationIdSchema('Session ID').pipe(
  Schema.fromBrand(SessionId),
)
export const sessionOperationNodeIdSchema = sessionOperationIdSchema('Session node ID').pipe(
  Schema.fromBrand(SessionNodeId),
)
export const sessionOperationBranchIdSchema = sessionOperationIdSchema('Session branch ID').pipe(
  Schema.fromBrand(SessionBranchId),
)

/**
 * A request to reposition one pin, expressed by the neighbours it should land between.
 *
 * Neighbours are session ids rather than sort keys so callers work from what they
 * rendered and never handle keys. `null` on either side means that end of the list.
 */
export const pinnedSessionMoveSchema = Schema.Struct({
  sessionId: sessionOperationSessionIdSchema,
  afterSessionId: Schema.NullOr(sessionOperationSessionIdSchema),
  beforeSessionId: Schema.NullOr(sessionOperationSessionIdSchema),
}).annotations({ message: () => 'Pinned Session move must be an object.' })

export const sessionWorkspaceSelectionSchema = Schema.Struct({
  branchId: Schema.optional(Schema.NullOr(sessionOperationBranchIdSchema)),
  nodeId: Schema.optional(Schema.NullOr(sessionOperationNodeIdSchema)),
}).annotations({ message: () => 'Session workspace selection must be an object.' })

const treeUiStatePatchFieldsSchema = Schema.Struct({
  expandedNodeIds: Schema.optional(
    Schema.Array(sessionOperationNodeIdSchema).pipe(
      Schema.maxItems(SESSION_INPUT_LIMITS.expandedTreeNodeItems, {
        message: () => 'Expanded session node IDs exceed the input limit.',
      }),
    ),
  ),
  branchesSidebarCollapsed: Schema.optional(
    Schema.Boolean.annotations({ message: () => 'Branches sidebar collapsed must be a boolean.' }),
  ),
  /** Durable read receipt for terminal Run state. */
  lastVisitedAt: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.nonNegative()).annotations({
      message: () => 'Session last-visited timestamp must be a non-negative integer.',
    }),
  ),
}).annotations({ message: () => 'Session tree UI state patch must be an object.' })

/** A change to a Session tree's UI state; it changes at least one field. */
export const sessionTreeUiStatePatchSchema = treeUiStatePatchFieldsSchema.pipe(
  Schema.filter(
    (patch) =>
      patch.expandedNodeIds !== undefined ||
      patch.branchesSidebarCollapsed !== undefined ||
      patch.lastVisitedAt !== undefined ||
      'Session tree UI state patch must include at least one field.',
  ),
)

const navigationInstructionsMessage = 'Session navigation custom instructions must be non-empty.'

export const sessionNavigateTreeOptionsSchema = Schema.Struct({
  summarize: Schema.optional(
    Schema.Boolean.annotations({
      message: () => 'Session navigation summarize must be a boolean.',
    }),
  ),
  customInstructions: Schema.optional(
    Schema.String.annotations({ message: () => navigationInstructionsMessage }).pipe(
      Schema.filter(
        (value) =>
          (value.trim().length > 0 && isSessionInputTextWithinLimit(value)) ||
          navigationInstructionsMessage,
      ),
    ),
  ),
}).annotations({ message: () => 'Session navigation options must be an object.' })

/** Per-session worktree birth plan persisted by the composer strip (WS1b). */
export const sessionWorktreePlanSchema = Schema.Struct({
  environmentMode: Schema.Literal(...SESSION_ENVIRONMENT_MODES).annotations({
    message: () => 'Session environment mode must be local or worktree.',
  }),
  baseRef: Schema.NullOr(
    Schema.String.annotations({
      message: () => 'Session Worktree base ref must be a string or null.',
    }),
  ),
  startFromOrigin: Schema.Boolean.annotations({
    message: () => 'Session Worktree origin selection must be a boolean.',
  }),
}).annotations({ message: () => 'Session worktree plan must be an object.' })

/** How the desktop user deletes a Session. */
export const sessionDeleteOptionsSchema = Schema.Struct({
  /** As part of removing its project: a discovered Pi file stays listable (ADR 0051). */
  removingProject: Schema.optional(
    Schema.Boolean.annotations({
      message: () => 'Session delete option removingProject must be a boolean.',
    }),
  ),
  /** Only while still archived (Settings > Archived items); see `SESSION_NOT_ARCHIVED_MESSAGE`. */
  requireArchived: Schema.optional(Schema.Boolean),
}).annotations({ message: () => 'Session delete options are invalid.' })

/**
 * The delete options the window may send on `sessions:delete`. `requireArchived` is the Host's
 * own guard for Archived items deletion, so the window cannot ask for it.
 */
export const sessionDeleteRequestOptionsSchema = sessionDeleteOptionsSchema
  .pipe(Schema.pick('removingProject'))
  .annotations({ message: () => 'Session delete options are invalid.' })
