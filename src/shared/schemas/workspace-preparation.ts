import { Schema } from '@shared/schema'
import {
  preparationDefinitionSchema,
  preparationProfileSchema,
  preparationReviewSchema,
} from './action-definitions'

export const preparationExecutionSchema = Schema.Struct({
  status: Schema.Literal('idle', 'running', 'succeeded', 'failed', 'skipped', 'review-required'),
  attemptId: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number),
  exitCode: Schema.NullOr(Schema.Number),
  error: Schema.NullOr(Schema.String),
  output: Schema.String,
  truncated: Schema.Boolean,
})
export const workspacePreparationSnapshotSchema = Schema.Struct({
  profile: preparationProfileSchema,
  capturedAt: Schema.Number,
  definitions: Schema.Array(
    Schema.Struct({
      definition: preparationDefinitionSchema,
      source: Schema.Literal('local', 'project', 'override'),
      review: Schema.Literal('enabled', 'disabled', 'required'),
      previous: Schema.optional(preparationReviewSchema),
    }),
  ),
})
export const storedWorkspacePreparationSchema = Schema.Struct({
  workspaceId: Schema.String,
  revision: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
  snapshot: workspacePreparationSnapshotSchema,
  setup: preparationExecutionSchema,
  cleanup: preparationExecutionSchema,
  environment: Schema.Record({ key: Schema.String, value: Schema.NullOr(Schema.String) }),
})
