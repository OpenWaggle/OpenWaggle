import { Schema } from '@shared/schema'
import { sessionInputIdSchema } from './session-input'

/** Where a Session Host event stream stands: the Host instance and its event sequence. */
export const sessionHostEventCursorSchema = Schema.Struct({
  hostInstanceId: sessionInputIdSchema,
  sequence: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})
