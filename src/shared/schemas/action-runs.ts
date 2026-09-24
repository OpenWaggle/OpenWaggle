import { Schema } from '@shared/schema'
import { ACTION_DEFINITION_LIMITS } from '@shared/types/action-definitions'
import { actionDefinitionSchema } from './action-definitions'

const id = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(ACTION_DEFINITION_LIMITS.ID_LENGTH),
)
const timestamp = Schema.Number.pipe(Schema.int(), Schema.nonNegative())
const path = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(ACTION_DEFINITION_LIMITS.PATH_LENGTH),
)
export const resolvedActionInvocationSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal('command'),
    command: Schema.String.pipe(Schema.maxLength(ACTION_DEFINITION_LIMITS.COMMAND_LENGTH)),
    cwd: path,
  }),
  Schema.Struct({
    type: Schema.Literal('executable'),
    executable: path,
    args: Schema.Array(Schema.String),
    cwd: path,
  }),
)
export const actionRunSchema = Schema.Struct({
  id,
  requestId: id,
  workspaceId: id,
  projectPath: path,
  workspacePath: path,
  action: actionDefinitionSchema,
  invocation: resolvedActionInvocationSchema,
  status: Schema.Literal(
    'starting',
    'running',
    'stopping',
    'completed',
    'failed',
    'stopped',
    'interrupted',
  ),
  startedAt: timestamp,
  finishedAt: Schema.NullOr(timestamp),
  exitCode: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  error: Schema.NullOr(Schema.String),
  previewUrl: Schema.NullOr(Schema.String),
  ready: Schema.Boolean,
  outputBytes: timestamp,
})
