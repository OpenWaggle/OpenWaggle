import { Schema } from '@shared/schema'
import { ACTION_DEFINITION_LIMITS } from '@shared/types/action-definitions'
import type { ActionManagementRequest } from '@shared/types/action-management'
import { actionCatalogEditSchema, actionDefinitionIdSchema } from './action-definitions'

const expectedRevision = Schema.Number.pipe(Schema.int(), Schema.nonNegative(), Schema.finite())
const REVISION_LENGTH = 256
const identifier = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(ACTION_DEFINITION_LIMITS.ID_LENGTH),
)
export const actionManagementRequestSchema: Schema.Schema<ActionManagementRequest> = Schema.Struct({
  scope: Schema.Struct({
    projectPath: Schema.String.pipe(
      Schema.minLength(1),
      Schema.maxLength(ACTION_DEFINITION_LIMITS.PATH_LENGTH),
    ),
    sessionId: Schema.optional(identifier),
    workspaceId: Schema.optional(identifier),
  }).pipe(Schema.filter((scope) => !scope.sessionId || !scope.workspaceId)),
  operation: Schema.Union(
    Schema.Struct({ type: Schema.Literal('stop-setup'), attemptId: identifier }),
    Schema.Struct({ type: Schema.Literal('preparation') }),
    Schema.Struct({
      type: Schema.Literal('select-preparation'),
      profileId: actionDefinitionIdSchema,
      expectedRevision,
    }),
    Schema.Struct({ type: Schema.Literal('adopt-preparation'), expectedRevision }),
    Schema.Struct({
      type: Schema.Literal('review-snapshot'),
      definitionId: actionDefinitionIdSchema,
      enabled: Schema.Boolean,
      expectedRevision,
    }),
    Schema.Struct({
      type: Schema.Literal('run-preparation'),
      phase: Schema.Literal('setup', 'cleanup'),
      expectedRevision,
    }),
    Schema.Struct({
      type: Schema.Literal('skip-preparation'),
      phase: Schema.Literal('setup', 'cleanup'),
      expectedRevision,
    }),
    Schema.Struct({ type: Schema.Literal('retained-preparation') }),
    Schema.Struct({ type: Schema.Literal('catalog') }),
    Schema.Struct({ type: Schema.Literal('discover') }),
    Schema.Struct({
      type: Schema.Literal('edit'),
      revision: Schema.String.pipe(Schema.maxLength(REVISION_LENGTH)),
      edit: actionCatalogEditSchema,
    }),
    Schema.Struct({ type: Schema.Literal('runs') }),
    Schema.Struct({
      type: Schema.Literal('start'),
      actionId: actionDefinitionIdSchema,
      requestId: identifier,
      restartRunId: Schema.optional(identifier),
    }),
    Schema.Struct({
      type: Schema.Literal('output'),
      runId: identifier,
      afterOffset: Schema.Number.pipe(Schema.int(), Schema.nonNegative(), Schema.finite()),
    }),
    Schema.Struct({ type: Schema.Literal('stop'), runId: identifier }),
  ),
})
