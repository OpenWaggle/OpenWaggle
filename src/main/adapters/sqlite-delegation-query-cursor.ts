import { isRecord } from '@shared/utils/validation'
import {
  DELEGATION_HISTORY_KINDS,
  type DelegationHistoryHighWater,
  type DelegationHistoryKind,
  type DelegationReadCursor,
  type DelegationReadRequest,
  type DelegationsListRequest,
} from './sqlite-delegation-query-model'
import { decodeSessionQueryCursor } from './sqlite-session-query-support'

function isDelegationHistoryKind(value: unknown): value is DelegationHistoryKind {
  return DELEGATION_HISTORY_KINDS.some((kind) => kind === value)
}

function historyHighWater(value: unknown): DelegationHistoryHighWater | null {
  if (!isRecord(value)) return null
  const amendment = value.amendment
  const claim = value.claim
  const conflict = value.conflict
  const review = value.review
  const specification = value.specification
  const submission = value.submission
  const transition = value.transition
  const undeclaredWrite = value['undeclared-write']
  const verification = value.verification
  if (
    typeof amendment !== 'number' ||
    typeof claim !== 'number' ||
    typeof conflict !== 'number' ||
    typeof review !== 'number' ||
    typeof specification !== 'number' ||
    typeof submission !== 'number' ||
    typeof transition !== 'number' ||
    typeof undeclaredWrite !== 'number' ||
    typeof verification !== 'number'
  ) {
    return null
  }
  return {
    amendment,
    claim,
    conflict,
    review,
    specification,
    submission,
    transition,
    'undeclared-write': undeclaredWrite,
    verification,
  }
}

export function readDelegationCursor(
  request: DelegationReadRequest,
): DelegationReadCursor | null | 'invalid' {
  const decoded = decodeSessionQueryCursor(request.query.cursor)
  if (decoded === 'invalid' || decoded === null) return decoded
  const through = historyHighWater(decoded.through)
  if (
    typeof decoded.createdAt !== 'number' ||
    !isDelegationHistoryKind(decoded.kind) ||
    typeof decoded.cursorId !== 'number' ||
    !through
  ) {
    return 'invalid'
  }
  return {
    createdAt: decoded.createdAt,
    kind: decoded.kind,
    cursorId: decoded.cursorId,
    through,
  }
}

export function readDelegationListCursor(request: DelegationsListRequest) {
  const cursor = decodeSessionQueryCursor(request.query.cursor)
  if (cursor === 'invalid') return 'invalid' as const
  if (!cursor) return null
  return typeof cursor.updatedAt === 'number' && typeof cursor.delegationId === 'string'
    ? { updatedAt: cursor.updatedAt, delegationId: cursor.delegationId }
    : ('invalid' as const)
}
