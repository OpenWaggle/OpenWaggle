import { SESSION_QUERY_MAX_RESPONSE_BYTES } from '@shared/types/session-query'
import {
  DELEGATION_HISTORY_KINDS,
  type DelegationHistoryDescriptor,
  type DelegationHistoryHighWater,
  type DelegationHistoryKind,
  type DelegationHistoryRows,
  type DelegationReadRequest,
} from './sqlite-delegation-query-model'
import { delegationReadResponse } from './sqlite-delegation-query-response'
import { encodeSessionQueryCursor, sessionQueryResponse } from './sqlite-session-query-support'

const DELEGATION_HISTORY_SQL_READ_BUDGET_BYTES = 24 * 1024 * 1024
const BINARY_SEARCH_DIVISOR = 2

export function selectedDelegationRowIds(
  rows: readonly DelegationHistoryDescriptor[],
  kind: DelegationHistoryKind,
) {
  return rows.filter((row) => row.kind === kind).map((row) => row.cursor_id)
}

export function selectDelegationHistoryPrefix(
  rows: readonly DelegationHistoryDescriptor[],
  limit: number,
) {
  const selected: DelegationHistoryDescriptor[] = []
  let bytes = 0
  for (const row of rows.slice(0, limit)) {
    if (
      selected.length > 0 &&
      bytes + row.estimated_bytes > DELEGATION_HISTORY_SQL_READ_BUDGET_BYTES
    ) {
      break
    }
    selected.push(row)
    bytes += row.estimated_bytes
  }
  return selected
}

function filterHistoryRows(
  rows: DelegationHistoryRows,
  selected: readonly DelegationHistoryDescriptor[],
) {
  const selectedIds = new Map<DelegationHistoryKind, ReadonlySet<number>>()
  for (const kind of DELEGATION_HISTORY_KINDS) {
    selectedIds.set(kind, new Set(selectedDelegationRowIds(selected, kind)))
  }
  const includes = (kind: DelegationHistoryKind, cursorId: number) =>
    selectedIds.get(kind)?.has(cursorId) === true
  return {
    ...rows,
    specifications: rows.specifications.filter((row) => includes('specification', row.cursor_id)),
    submissions: rows.submissions.filter((row) => includes('submission', row.cursor_id)),
    reviews: rows.reviews.filter((row) => includes('review', row.cursor_id)),
    transitions: rows.transitions.filter((row) => includes('transition', row.cursor_id)),
    claimRevisions: rows.claimRevisions.filter((row) => includes('claim', row.cursor_id)),
    undeclaredWrites: rows.undeclaredWrites.filter((row) =>
      includes('undeclared-write', row.cursor_id),
    ),
    conflicts: rows.conflicts.filter((row) => includes('conflict', row.cursor_id)),
    amendmentProposals: rows.amendmentProposals.filter((row) =>
      includes('amendment', row.cursor_id),
    ),
    verifications: rows.verifications.filter((row) => includes('verification', row.cursor_id)),
  }
}

function fitDelegationPage(
  request: DelegationReadRequest,
  rows: DelegationHistoryRows,
  selected: readonly DelegationHistoryDescriptor[],
  hasAdditional: boolean,
  through: DelegationHistoryHighWater,
) {
  const filtered = filterHistoryRows(rows, selected)
  const last = selected.at(-1)
  const nextCursor =
    last && hasAdditional
      ? encodeSessionQueryCursor({
          createdAt: last.created_at,
          kind: last.kind,
          cursorId: last.cursor_id,
          through,
        })
      : undefined
  const responseRows = { ...filtered, ...(nextCursor ? { nextCursor } : {}) }
  const response = sessionQueryResponse(request, delegationReadResponse(responseRows))
  return {
    fits: Buffer.byteLength(JSON.stringify(response)) <= SESSION_QUERY_MAX_RESPONSE_BYTES,
    rows: responseRows,
  }
}

export function fitDelegationHistoryPage(
  request: DelegationReadRequest,
  rows: DelegationHistoryRows,
  selected: readonly DelegationHistoryDescriptor[],
  descriptorCount: number,
  through: DelegationHistoryHighWater,
) {
  const emptyPage = fitDelegationPage(request, rows, [], descriptorCount > 0, through)
  if (!emptyPage.fits) return { status: 'record-too-large' as const }
  if (selected.length === 0) return { status: 'found' as const, rows: emptyPage.rows }

  let lower = 1
  let upper = selected.length
  let fitted: ReturnType<typeof fitDelegationPage> | undefined
  while (lower <= upper) {
    const count = Math.floor((lower + upper) / BINARY_SEARCH_DIVISOR)
    const candidate = fitDelegationPage(
      request,
      rows,
      selected.slice(0, count),
      descriptorCount > count,
      through,
    )
    if (candidate.fits) {
      fitted = candidate
      lower = count + 1
    } else {
      upper = count - 1
    }
  }
  return fitted
    ? { status: 'found' as const, rows: fitted.rows }
    : { status: 'record-too-large' as const }
}
