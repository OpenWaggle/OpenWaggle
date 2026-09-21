import { Schema } from '@shared/schema'
import { sessionInputIdSchema, sessionInputItemTextSchema } from './session-input'
import { sessionTitleSchema } from './session-title'

export const sessionRenameCommandSchema = Schema.Struct({
  operation: Schema.Literal('rename'),
  sessionId: sessionInputIdSchema,
  title: sessionTitleSchema,
})

export const sessionArchiveCommandSchema = Schema.Struct({
  operation: Schema.Literal('archive'),
  sessionId: sessionInputIdSchema,
})

export const sessionUnarchiveCommandSchema = Schema.Struct({
  operation: Schema.Literal('unarchive'),
  sessionId: sessionInputIdSchema,
})

export const sessionHandoffCommandSchema = Schema.Struct({
  operation: Schema.Literal('handoff'),
  sessionId: sessionInputIdSchema,
  workspace: Schema.Union(
    Schema.Struct({ mode: Schema.Literal('local') }),
    Schema.Struct({ mode: Schema.Literal('existing'), workspaceId: sessionInputIdSchema }),
    Schema.Struct({
      mode: Schema.Literal('new-worktree'),
      baseRef: Schema.optional(sessionInputItemTextSchema),
      startFromOrigin: Schema.optional(Schema.Boolean),
    }),
  ),
})

export const sessionRenamedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('rename'),
  effect: Schema.Literal('session-renamed'),
  sessionId: Schema.String,
  title: sessionTitleSchema,
})

export const sessionArchivedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('archive'),
  effect: Schema.Literal('session-archived'),
  sessionId: Schema.String,
})

export const sessionUnarchivedOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('unarchive'),
  effect: Schema.Literal('session-unarchived'),
  sessionId: Schema.String,
})

export const sessionHandedOffOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('handoff'),
  effect: Schema.Literal('session-handed-off'),
  sessionId: Schema.String,
  previousWorkspaceId: Schema.String,
  workspaceId: Schema.String,
  workspaceState: Schema.Literal('ready', 'pending'),
})

export const sessionOrganizationCommandSchemas = [
  sessionRenameCommandSchema,
  sessionArchiveCommandSchema,
  sessionUnarchiveCommandSchema,
  sessionHandoffCommandSchema,
] as const

export const sessionOrganizationOutcomeSchemas = [
  sessionRenamedOutcomeSchema,
  sessionArchivedOutcomeSchema,
  sessionUnarchivedOutcomeSchema,
  sessionHandedOffOutcomeSchema,
] as const
