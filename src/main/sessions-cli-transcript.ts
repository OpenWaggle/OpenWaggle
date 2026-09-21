import { randomUUID } from 'node:crypto'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import { isRecord } from '@shared/utils/validation'
import type { LocalSessionCliClientInput } from './local-session-cli-client'
import { option, type ParsedArguments } from './mcp-cli-arguments'
import { executeLocalSessionCommand } from './session-host/local-session-client'
import { writeSessionsCliStreamRecord } from './sessions-cli-output'
import { FULL_TRANSCRIPT_PAGE_LIMIT } from './sessions-cli-payload'

interface TranscriptCursor {
  afterCreatedOrder?: number
  throughCreatedOrder?: number
  selectedBranchId?: string | null
  snapshotHeadNodeId?: string | null
}

function transcriptOutcome(value: unknown) {
  if (!isRecord(value) || !isRecord(value.response) || !isRecord(value.response.outcome)) return
  return value.response.outcome
}

function optionalNumber(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'number' ? value : undefined
}

function optionalNullableString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' || value === null ? value : undefined
}

function transcriptPage(value: unknown) {
  const outcome = transcriptOutcome(value)
  if (!outcome) return
  if (isRecord(outcome.error)) {
    const code = 'code' in outcome.error ? String(outcome.error.code) : 'query_failed'
    const message = 'message' in outcome.error ? String(outcome.error.message) : 'Query failed.'
    throw new Error(`${code}: ${message}`)
  }
  if (!Array.isArray(outcome.items)) return
  return {
    items: outcome.items.map((item: unknown) => item),
    highWaterMark: optionalNumber(outcome, 'highWaterMark'),
    nextCreatedOrder: optionalNumber(outcome, 'nextCreatedOrder'),
    branchScope:
      outcome.branchScope === 'tree' || outcome.branchScope === 'active-branch'
        ? outcome.branchScope
        : undefined,
    selectedBranchId: optionalNullableString(outcome, 'selectedBranchId'),
    snapshotHeadNodeId: optionalNullableString(outcome, 'snapshotHeadNodeId'),
  }
}

function transcriptBranchSelection(arguments_: ParsedArguments) {
  const branchScope = option(arguments_, 'scope') ?? 'active-branch'
  if (branchScope !== 'active-branch' && branchScope !== 'tree') {
    throw new Error('--scope must be active-branch or tree.')
  }
  const branchId = option(arguments_, 'branch')
  if (branchScope === 'tree' && branchId) {
    throw new Error('--branch requires --scope active-branch.')
  }
  return { branchScope, branchId } as const
}

function transcriptRequest(
  sessionId: string,
  selection: ReturnType<typeof transcriptBranchSelection>,
  cursor: TranscriptCursor,
) {
  const branchId =
    cursor.selectedBranchId === undefined ? selection.branchId : cursor.selectedBranchId
  return {
    contract: 'session-query-v2' as const,
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'items' as const,
        sessionId,
        limit: FULL_TRANSCRIPT_PAGE_LIMIT,
        branchScope: selection.branchScope,
        ...(branchId ? { branchId } : {}),
        ...(cursor.afterCreatedOrder === undefined
          ? {}
          : { afterCreatedOrder: cursor.afterCreatedOrder }),
        ...(cursor.throughCreatedOrder === undefined
          ? {}
          : { throughCreatedOrder: cursor.throughCreatedOrder }),
        ...(cursor.snapshotHeadNodeId ? { snapshotHeadNodeId: cursor.snapshotHeadNodeId } : {}),
      },
    },
  }
}

export async function streamFullTranscript(input: {
  readonly sessionId: string
  readonly session: unknown
  readonly clientInput: LocalSessionCliClientInput
  readonly jsonl: boolean
  readonly arguments: ParsedArguments
}) {
  await writeSessionsCliStreamRecord({ record: 'session', session: input.session }, input.jsonl)
  const cursor: TranscriptCursor = {}
  const selection = transcriptBranchSelection(input.arguments)
  while (true) {
    const result = await executeLocalSessionCommand({
      ...input.clientInput,
      payload: transcriptRequest(input.sessionId, selection, cursor),
    })
    const page = transcriptPage(result)
    if (
      !page ||
      page.highWaterMark === undefined ||
      page.branchScope === undefined ||
      page.selectedBranchId === undefined ||
      page.snapshotHeadNodeId === undefined
    ) {
      throw new Error('Local Session Host returned an invalid transcript page.')
    }
    cursor.throughCreatedOrder ??= page.highWaterMark
    if (cursor.selectedBranchId === undefined) cursor.selectedBranchId = page.selectedBranchId
    if (cursor.snapshotHeadNodeId === undefined) cursor.snapshotHeadNodeId = page.snapshotHeadNodeId
    for (const item of page.items) {
      await writeSessionsCliStreamRecord({ record: 'item', item }, input.jsonl)
    }
    if (page.nextCreatedOrder === undefined) {
      await writeSessionsCliStreamRecord(
        { record: 'end', highWaterMark: cursor.throughCreatedOrder },
        input.jsonl,
      )
      return
    }
    cursor.afterCreatedOrder = page.nextCreatedOrder
  }
}
