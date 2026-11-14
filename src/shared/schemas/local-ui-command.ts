import { Schema } from '@shared/schema'
import { SESSION_INPUT_LIMITS } from '@shared/session-input-limits'
import { SessionNodeId } from '@shared/types/brand'
import {
  sessionInputIdSchema,
  sessionInputItemTextSchema,
  sessionInputTextSchema,
} from './session-input'
import { sessionDeleteOptionsSchema } from './session-operation-requests'

/*
 * The navigate-tree options and tree UI patch the Local Session socket accepts. They are looser
 * than the window's `sessions:*` request schemas in `session-operation-requests` (no non-blank or
 * at-least-one-field rule), as the socket always accepted; the types come from those schemas.
 * Their fields stay `Schema.optional` (an explicit undefined is accepted) because the window's
 * request types they carry, `SessionNavigateTreeOptions` and `SessionTreeUiStatePatch`, are.
 */
const navigateTreeOptionsSchema = Schema.Struct({
  summarize: Schema.optionalWith(Schema.Boolean, { exact: true }),
  customInstructions: Schema.optionalWith(sessionInputTextSchema, { exact: true }),
})

const treeUiStatePatchSchema = Schema.Struct({
  expandedNodeIds: Schema.optionalWith(
    Schema.Array(sessionInputIdSchema.pipe(Schema.fromBrand(SessionNodeId))).pipe(
      Schema.maxItems(SESSION_INPUT_LIMITS.expandedTreeNodeItems),
    ),
    { exact: true },
  ),
  branchesSidebarCollapsed: Schema.optionalWith(Schema.Boolean, { exact: true }),
  /** Durable read receipt for terminal Run state. */
  lastVisitedAt: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.nonNegative()), {
    exact: true,
  }),
})

/** A `local-ui-v1` command: a desktop-window change to one Session's pins, tree or lifetime. */
export const localUiCommandSchema = Schema.Union(
  Schema.Struct({ operation: Schema.Literal('pin'), sessionId: sessionInputIdSchema }),
  Schema.Struct({ operation: Schema.Literal('unpin'), sessionId: sessionInputIdSchema }),
  Schema.Struct({
    operation: Schema.Literal('move-pin'),
    sessionId: sessionInputIdSchema,
    afterSessionId: Schema.NullOr(sessionInputIdSchema),
    beforeSessionId: Schema.NullOr(sessionInputIdSchema),
  }),
  Schema.Struct({
    operation: Schema.Literal('delete'),
    sessionId: sessionInputIdSchema,
    ...sessionDeleteOptionsSchema.fields,
  }),
  Schema.Struct({
    /** Keeps a Follow-up edit hold alive; not journaled (ADR 0044). */
    operation: Schema.Literal('renew-follow-up-edit-hold'),
    sessionId: sessionInputIdSchema,
    followUpId: sessionInputIdSchema,
    holdId: sessionInputIdSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('dismiss-interrupted-run'),
    sessionId: sessionInputIdSchema,
    runId: sessionInputIdSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('navigate-tree'),
    sessionId: sessionInputIdSchema,
    model: sessionInputIdSchema,
    targetNodeId: sessionInputIdSchema,
    options: Schema.optionalWith(navigateTreeOptionsSchema, { exact: true }),
  }),
  Schema.Struct({
    operation: Schema.Literal('rename-branch'),
    sessionId: sessionInputIdSchema,
    branchId: sessionInputIdSchema,
    name: sessionInputItemTextSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('archive-branch'),
    sessionId: sessionInputIdSchema,
    branchId: sessionInputIdSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('restore-branch'),
    sessionId: sessionInputIdSchema,
    branchId: sessionInputIdSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('update-tree-ui-state'),
    sessionId: sessionInputIdSchema,
    patch: treeUiStatePatchSchema,
  }),
)
