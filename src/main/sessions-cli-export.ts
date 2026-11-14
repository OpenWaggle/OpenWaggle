import { randomUUID } from 'node:crypto'
import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { sessionExportManifestSchema } from '@shared/schemas/session-export-operation'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import { sessionExportMarkdownHeading } from '@shared/utils/session-export-markdown'
import { writeCliStdout } from './cli-stdout'
import type { createLocalSessionCliClientInput } from './local-session-cli-client'
import { hasFlag, type ParsedArguments } from './mcp-cli-arguments'
import { pageQueryRefusal } from './session-cli-exit-status'
import { executeLocalSessionCommand } from './session-host/local-session-client'
import { FULL_TRANSCRIPT_PAGE_LIMIT } from './sessions-cli-payload'
import { commandResponseOutcome, pageRefusalOf } from './sessions-cli-response-fields'

type ClientInput = Awaited<ReturnType<typeof createLocalSessionCliClientInput>>
type ExportFormat = 'jsonl' | 'markdown'
const JSON_INDENT_SPACES = 2

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The members of an export page outcome the CLI writes. */
const exportPageSchema = Schema.Struct({
  manifest: Schema.Unknown,
  records: Schema.Array(Schema.Unknown),
  nextCreatedOrder: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

function exportPage(value: unknown) {
  const outcome = commandResponseOutcome(value)
  if (!outcome) return undefined
  const refusal = pageRefusalOf(outcome)
  if (refusal) throw pageQueryRefusal(refusal)
  if (!('manifest' in outcome) || !Schema.is(exportPageSchema)(outcome)) return undefined
  return {
    manifest: outcome.manifest,
    records: outcome.records,
    nextCreatedOrder:
      typeof outcome.nextCreatedOrder === 'number' ? outcome.nextCreatedOrder : undefined,
  }
}

/** The manifest members the Markdown header shows, each still unchecked. */
interface ExportManifestHeaderFields {
  readonly title?: unknown
  readonly sessionId?: unknown
  readonly branchScope?: unknown
  readonly activeTurnIncomplete?: unknown
}

const textContentSchema = Schema.Struct({ text: Schema.String })

function markdownContent(content: unknown) {
  if (typeof content === 'string') return content
  if (isRecord(content) && Schema.is(textContentSchema)(content)) return content.text
  return `\`\`\`json\n${JSON.stringify(content, null, JSON_INDENT_SPACES)}\n\`\`\``
}

function textField(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback
}

function writeHeader(manifest: unknown, format: ExportFormat) {
  if (format === 'jsonl') {
    return writeCliStdout(`${JSON.stringify({ record: 'manifest', manifest })}\n`)
  }
  const value: ExportManifestHeaderFields = isRecord(manifest) ? manifest : {}
  return writeCliStdout(
    `# ${textField(value.title, 'Session export')}\n\n` +
      `- Session: ${textField(value.sessionId, '')}\n` +
      `- Scope: ${textField(value.branchScope, '')}\n` +
      `- Active turn incomplete: ${value.activeTurnIncomplete === true ? 'yes' : 'no'}\n\n`,
  )
}

/** One exported record as Markdown: its heading (the Host's notice is not the user) and content. */
export function markdownExportRecord(record: {
  readonly role?: unknown
  readonly metadata?: unknown
  readonly content?: unknown
}) {
  return `## ${sessionExportMarkdownHeading(record)}\n\n${markdownContent(record.content ?? record)}\n\n`
}

async function writeRecords(records: readonly unknown[], format: ExportFormat) {
  for (const record of records) {
    if (format === 'jsonl') {
      await writeCliStdout(`${JSON.stringify(record)}\n`)
      continue
    }
    if (!isRecord(record)) continue
    await writeCliStdout(markdownExportRecord(record))
  }
}

function requestedFormat(arguments_: ParsedArguments) {
  const selected = arguments_.options.get('format')?.at(-1)
  if (selected && selected !== 'jsonl' && selected !== 'markdown') {
    throw new Error('Unsupported export format. Expected markdown or jsonl.')
  }
  return hasFlag(arguments_, 'jsonl') || selected === 'jsonl'
    ? ('jsonl' as const)
    : ('markdown' as const)
}

export function continuationQuery(input: {
  readonly sessionId: string
  readonly afterCreatedOrder: number
  readonly manifest: unknown
  readonly arguments: ParsedArguments
}) {
  const snapshotManifest = decodeUnknownExactOrThrow(sessionExportManifestSchema, input.manifest)
  const manifest = snapshotManifest
  const snapshot = manifest.snapshot
  const branchId =
    input.arguments.options.get('branch')?.at(-1) ??
    (typeof manifest.selectedBranchId === 'string' ? manifest.selectedBranchId : undefined)
  return {
    operation: 'export' as const,
    sessionId: input.sessionId,
    limit: FULL_TRANSCRIPT_PAGE_LIMIT,
    branchScope:
      input.arguments.options.get('scope')?.at(-1) === 'tree'
        ? ('tree' as const)
        : ('active-branch' as const),
    ...(branchId ? { branchId } : {}),
    ...(hasFlag(input.arguments, 'include-queue-bodies') ? { includeQueueBodies: true } : {}),
    afterCreatedOrder: input.afterCreatedOrder,
    ...(typeof snapshot.nodeHighWaterMark === 'number'
      ? { throughCreatedOrder: snapshot.nodeHighWaterMark }
      : {}),
    ...(typeof snapshot.stateRevision === 'number'
      ? { snapshotStateRevision: snapshot.stateRevision }
      : {}),
    ...(typeof snapshot.selectedHeadNodeId === 'string'
      ? { snapshotHeadNodeId: snapshot.selectedHeadNodeId }
      : {}),
    ...(typeof snapshot.capturedAt === 'number' ? { capturedAt: snapshot.capturedAt } : {}),
    snapshotManifest,
  }
}

export async function streamSessionExport(input: {
  readonly sessionId: string
  readonly firstResult: unknown
  readonly clientInput: ClientInput
  readonly arguments: ParsedArguments
}) {
  const format = requestedFormat(input.arguments)
  let page = exportPage(input.firstResult)
  if (!page) throw new Error('Local Session Host returned an invalid export page.')
  const firstManifest = page.manifest
  await writeHeader(firstManifest, format)
  await writeRecords(page.records, format)
  while (page.nextCreatedOrder !== undefined) {
    const result = await executeLocalSessionCommand({
      ...input.clientInput,
      payload: {
        contract: 'session-query-v2',
        request: {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: randomUUID(),
          query: continuationQuery({
            sessionId: input.sessionId,
            afterCreatedOrder: page.nextCreatedOrder,
            manifest: firstManifest,
            arguments: input.arguments,
          }),
        },
      },
    })
    page = exportPage(result)
    if (!page) throw new Error('Local Session Host returned an invalid export page.')
    await writeRecords(page.records, format)
  }
}
