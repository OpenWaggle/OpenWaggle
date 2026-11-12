import { Schema } from '@shared/schema'
import {
  DELEGATION_HISTORY_KINDS,
  type DelegationReadCursor,
  type DelegationReadRequest,
  type DelegationsListRequest,
} from './sqlite-delegation-query-model'
import { decodeSessionQueryCursor } from './sqlite-session-query-support'

const delegationHistoryKindSchema = Schema.Literal(...DELEGATION_HISTORY_KINDS)

/** How far each history kind reached when the first page was read. */
const historyHighWaterSchema = Schema.Struct({
  amendment: Schema.Number,
  claim: Schema.Number,
  conflict: Schema.Number,
  review: Schema.Number,
  specification: Schema.Number,
  submission: Schema.Number,
  transition: Schema.Number,
  'undeclared-write': Schema.Number,
  verification: Schema.Number,
})

const delegationReadCursorSchema = Schema.Struct({
  createdAt: Schema.Number,
  kind: delegationHistoryKindSchema,
  cursorId: Schema.Number,
  through: historyHighWaterSchema,
})

export function readDelegationCursor(
  request: DelegationReadRequest,
): DelegationReadCursor | null | 'invalid' {
  return decodeSessionQueryCursor(request.query.cursor, delegationReadCursorSchema)
}

export function readDelegationListCursor(request: DelegationsListRequest) {
  return decodeSessionQueryCursor(
    request.query.cursor,
    Schema.Struct({ updatedAt: Schema.Number, delegationId: Schema.String }),
  )
}
