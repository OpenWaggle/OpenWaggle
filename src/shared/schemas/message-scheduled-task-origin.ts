import { Schema } from '@shared/schema'
import { SCHEDULED_TASK_KINDS } from '@shared/types/scheduled-task'

/** `MessageScheduledTaskOrigin`: the Scheduled task whose run delivered a user message. */
export const messageScheduledTaskOriginSchema = Schema.Struct({
  taskId: Schema.String.pipe(Schema.minLength(1)),
  name: Schema.String.pipe(Schema.minLength(1)),
  kind: Schema.optional(Schema.Literal(...SCHEDULED_TASK_KINDS)),
})
