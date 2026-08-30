import { randomUUID } from 'node:crypto'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import type { createLocalSessionCliClientInput } from './local-session-cli-client'
import { hasFlag, type ParsedArguments } from './mcp-cli-arguments'
import { executeLocalSessionCommand } from './session-host/local-session-client'
import { FULL_TRANSCRIPT_PAGE_LIMIT } from './sessions-cli-payload'

type ClientInput = Awaited<ReturnType<typeof createLocalSessionCliClientInput>>
type ExportFormat = 'jsonl' | 'markdown'
const JSON_INDENT_SPACES = 2

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exportPage(value: unknown) {
  if (!isRecord(value) || !isRecord(value.response) || !isRecord(value.response.outcome)) {
    return undefined
  }
  const outcome = value.response.outcome
  if (!('manifest' in outcome) || !Array.isArray(outcome.records)) return undefined
  return {
    manifest: outcome.manifest,
    records: outcome.records,
    nextCreatedOrder:
      typeof outcome.nextCreatedOrder === 'number' ? outcome.nextCreatedOrder : undefined,
  }
}

function markdownContent(content: unknown) {
  if (typeof content === 'string') return content
  if (isRecord(content) && typeof content.text === 'string') return content.text
  return `\`\`\`json\n${JSON.stringify(content, null, JSON_INDENT_SPACES)}\n\`\`\``
}

function writeHeader(manifest: unknown, format: ExportFormat) {
  if (format === 'jsonl') {
    process.stdout.write(`${JSON.stringify({ record: 'manifest', manifest })}\n`)
    return
  }
  const value = isRecord(manifest) ? manifest : {}
  process.stdout.write(
    `# ${String(value.title ?? 'Session export')}\n\n` +
      `- Session: ${String(value.sessionId ?? '')}\n` +
      `- Scope: ${String(value.branchScope ?? '')}\n` +
      `- Active turn incomplete: ${value.activeTurnIncomplete === true ? 'yes' : 'no'}\n\n`,
  )
}

function writeRecords(records: readonly unknown[], format: ExportFormat) {
  for (const record of records) {
    if (format === 'jsonl') {
      process.stdout.write(`${JSON.stringify(record)}\n`)
      continue
    }
    if (!isRecord(record)) continue
    process.stdout.write(
      `## ${String(record.role ?? 'event')}\n\n${markdownContent(record.content ?? record)}\n\n`,
    )
  }
}

function requestedFormat(arguments_: ParsedArguments): ExportFormat {
  const selected = arguments_.options.get('format')?.at(-1)
  if (selected && selected !== 'jsonl' && selected !== 'markdown') {
    throw new Error('Unsupported export format. Expected markdown or jsonl.')
  }
  return hasFlag(arguments_, 'jsonl') || selected === 'jsonl' ? 'jsonl' : 'markdown'
}

export function continuationQuery(input: {
  readonly sessionId: string
  readonly afterCreatedOrder: number
  readonly manifest: unknown
  readonly arguments: ParsedArguments
}) {
  const manifest = isRecord(input.manifest) ? input.manifest : {}
  const snapshot = isRecord(manifest.snapshot) ? manifest.snapshot : {}
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
    ...(typeof snapshot.capturedAt === 'number' ? { capturedAt: snapshot.capturedAt } : {}),
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
  writeHeader(firstManifest, format)
  writeRecords(page.records, format)
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
    writeRecords(page.records, format)
  }
}
