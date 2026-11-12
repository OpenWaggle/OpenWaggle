import { randomUUID } from 'node:crypto'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import { Schema } from '@shared/schema'
import type { LocalSessionCliClientInput } from './local-session-cli-client'
import { option, type ParsedArguments } from './mcp-cli-arguments'
import { pageQueryRefusal } from './session-cli-exit-status'
import { executeLocalSessionCommand } from './session-host/local-session-client'
import { writeSessionsCliStreamRecord } from './sessions-cli-output'
import { FULL_TRANSCRIPT_PAGE_LIMIT } from './sessions-cli-payload'
import { commandResponseOutcome, pageRefusalOf } from './sessions-cli-response-fields'

interface TranscriptCursor {
  afterCreatedOrder?: number
  throughCreatedOrder?: number
  selectedBranchId?: string | null
  snapshotHeadNodeId?: string | null
}

/** The members of a transcript page outcome the CLI reads, each still unchecked but `items`. */
const transcriptPageSchema = Schema.Struct({
  items: Schema.Array(Schema.Unknown),
  highWaterMark: Schema.optional(Schema.Unknown),
  nextCreatedOrder: Schema.optional(Schema.Unknown),
  branchScope: Schema.optional(Schema.Unknown),
  selectedBranchId: Schema.optional(Schema.Unknown),
  snapshotHeadNodeId: Schema.optional(Schema.Unknown),
})

function optionalNumber(value: unknown) {
  return typeof value === 'number' ? value : undefined
}

function optionalNullableString(value: unknown) {
  return typeof value === 'string' || value === null ? value : undefined
}

function transcriptPage(value: unknown) {
  const outcome = commandResponseOutcome(value)
  if (!outcome) return
  const refusal = pageRefusalOf(outcome)
  if (refusal) throw pageQueryRefusal(refusal)
  if (!Schema.is(transcriptPageSchema)(outcome)) return
  return {
    items: outcome.items.map((item: unknown) => item),
    highWaterMark: optionalNumber(outcome.highWaterMark),
    nextCreatedOrder: optionalNumber(outcome.nextCreatedOrder),
    branchScope:
      outcome.branchScope === 'tree' || outcome.branchScope === 'active-branch'
        ? outcome.branchScope
        : undefined,
    selectedBranchId: optionalNullableString(outcome.selectedBranchId),
    snapshotHeadNodeId: optionalNullableString(outcome.snapshotHeadNodeId),
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
      page?.highWaterMark === undefined ||
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
