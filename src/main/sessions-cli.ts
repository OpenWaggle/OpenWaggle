import { randomUUID } from 'node:crypto'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import { isRecord } from '@shared/utils/validation'
import { writeCliStdout } from './cli-stdout'
import { validateImplicitCliHelp } from './command-cli-option-contract'
import { createLocalSessionCliClientInput } from './local-session-cli-client'
import { hasFlag, parseMcpCliArguments } from './mcp-cli-arguments'
import {
  SESSION_CLI_EXIT as EXIT,
  sessionCliExitCodeForError,
  sessionCliResultErrorKind,
} from './session-cli-exit-status'
import {
  executeLocalSessionCommand,
  watchLocalSessionEvents,
} from './session-host/local-session-client'
import { required, watchCursor } from './sessions-cli-arguments'
import { streamSessionExport } from './sessions-cli-export'
import { watchSessionExportOperations } from './sessions-cli-export-operation'
import { isSessionExportOperationCliCommand } from './sessions-cli-export-operation-payload'
import { resolveSessionsCliMessageInput } from './sessions-cli-message-input'
import { validateSessionsCliOptions } from './sessions-cli-option-contract'
import {
  validateSessionsCliOutputMode,
  writeSessionsCliError,
  writeSessionsCliResponse,
  writeSessionsCliStreamRecord,
} from './sessions-cli-output'
import { buildSessionsCliPayload, FULL_TRANSCRIPT_PAGE_LIMIT } from './sessions-cli-payload'
import { sessionsCliUsage } from './sessions-cli-usage'

export { buildSessionsCliPayload } from './sessions-cli-payload'

type ClientInput = Awaited<ReturnType<typeof createLocalSessionCliClientInput>>

async function runWatchCommand(
  arguments_: ReturnType<typeof parseMcpCliArguments>,
  clientInput: ClientInput,
) {
  const sessionIds = new Set(arguments_.positionals)
  const abortController = new AbortController()
  const interrupt = () => abortController.abort()
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    const after = watchCursor(arguments_)
    const jsonl = hasFlag(arguments_, 'jsonl')
    const writeCursor = (cursor: { readonly hostInstanceId: string; readonly sequence: number }) =>
      writeSessionsCliStreamRecord({ kind: 'cursor', cursor }, jsonl)
    const result = await watchLocalSessionEvents({
      ...clientInput,
      ...(after ? { after } : {}),
      signal: abortController.signal,
      onCursor: writeCursor,
      onEvent: async (event) => {
        if (
          sessionIds.size > 0 &&
          (event.payload.kind === 'semantic-discovery-readiness-changed' ||
            !sessionIds.has(event.payload.sessionId))
        ) {
          await writeCursor(event.cursor)
          return
        }
        await writeSessionsCliStreamRecord(event, jsonl)
      },
    })
    if (result.status === 'resync-required') {
      await writeSessionsCliStreamRecord(result, jsonl)
      return EXIT.FAILURE
    }
    return EXIT.SUCCESS
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
  }
}

function transcriptOutcome(value: unknown) {
  if (!isRecord(value) || !isRecord(value.response) || !isRecord(value.response.outcome)) {
    return undefined
  }
  return value.response.outcome
}

function throwTranscriptOutcomeError(outcome: Record<string, unknown>) {
  if (isRecord(outcome.error)) {
    const code = 'code' in outcome.error ? String(outcome.error.code) : 'query_failed'
    const message = 'message' in outcome.error ? String(outcome.error.message) : 'Query failed.'
    throw new Error(`${code}: ${message}`)
  }
}

function optionalNumber(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'number' ? value : undefined
}

function transcriptPage(value: unknown) {
  const outcome = transcriptOutcome(value)
  if (!outcome) return undefined
  throwTranscriptOutcomeError(outcome)
  if (!('items' in outcome)) return undefined
  if (!Array.isArray(outcome.items)) return undefined
  return {
    items: outcome.items.map((item: unknown) => item),
    highWaterMark: optionalNumber(outcome, 'highWaterMark'),
    nextCreatedOrder: optionalNumber(outcome, 'nextCreatedOrder'),
  }
}

async function streamFullTranscript(
  sessionId: string,
  session: unknown,
  clientInput: ClientInput,
  jsonl: boolean,
) {
  await writeSessionsCliStreamRecord({ record: 'session', session }, jsonl)
  let afterCreatedOrder: number | undefined
  let throughCreatedOrder: number | undefined
  while (true) {
    const result = await executeLocalSessionCommand({
      ...clientInput,
      payload: {
        contract: 'session-query-v2',
        request: {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: randomUUID(),
          query: {
            operation: 'items',
            sessionId,
            limit: FULL_TRANSCRIPT_PAGE_LIMIT,
            ...(afterCreatedOrder === undefined ? {} : { afterCreatedOrder }),
            ...(throughCreatedOrder === undefined ? {} : { throughCreatedOrder }),
          },
        },
      },
    })
    const page = transcriptPage(result)
    if (!page || page.highWaterMark === undefined) {
      throw new Error('Local Session Host returned an invalid transcript page.')
    }
    throughCreatedOrder ??= page.highWaterMark
    for (const item of page.items) {
      await writeSessionsCliStreamRecord({ record: 'item', item }, jsonl)
    }
    if (page.nextCreatedOrder === undefined) {
      await writeSessionsCliStreamRecord(
        { record: 'end', highWaterMark: throughCreatedOrder },
        jsonl,
      )
      return
    }
    afterCreatedOrder = page.nextCreatedOrder
  }
}

async function runSessionCommand(
  command: string,
  arguments_: ReturnType<typeof parseMcpCliArguments>,
  clientInput: ClientInput,
  payload: ReturnType<typeof buildSessionsCliPayload> | undefined,
) {
  if (command === 'watch') return runWatchCommand(arguments_, clientInput)
  if (command === 'export' && arguments_.positionals[0] === 'watch') {
    const result = await watchSessionExportOperations(arguments_, clientInput)
    return result.status === 'resync-required' ? EXIT.FAILURE : EXIT.SUCCESS
  }
  const result = await executeLocalSessionCommand({
    ...clientInput,
    payload: payload ?? buildSessionsCliPayload(command, arguments_),
  })
  const resultError = sessionCliResultErrorKind(result)
  if (resultError) {
    await writeSessionsCliResponse(command, result, hasFlag(arguments_, 'json'))
    return sessionCliExitCodeForError(resultError)
  }
  if (command === 'read' && hasFlag(arguments_, 'full')) {
    const sessionId = required(arguments_.positionals[0], 'Session ID')
    await streamFullTranscript(sessionId, result, clientInput, hasFlag(arguments_, 'jsonl'))
    return EXIT.SUCCESS
  }
  if (command === 'export' && !isSessionExportOperationCliCommand(arguments_.positionals[0])) {
    await streamSessionExport({
      sessionId: required(arguments_.positionals[0], 'Session ID'),
      firstResult: result,
      clientInput,
      arguments: arguments_,
    })
    return EXIT.SUCCESS
  }
  await writeSessionsCliResponse(command, result, hasFlag(arguments_, 'json'))
  return EXIT.SUCCESS
}

function isStreamingCommand(command: string, arguments_: ReturnType<typeof parseMcpCliArguments>) {
  if (command === 'watch') return true
  if (command === 'read' && hasFlag(arguments_, 'full')) return true
  if (command !== 'export') return false
  return (
    arguments_.positionals[0] === 'watch' ||
    !isSessionExportOperationCliCommand(arguments_.positionals[0])
  )
}

function commandPayload(
  command: string,
  arguments_: ReturnType<typeof parseMcpCliArguments>,
  resolvedPayload: ReturnType<typeof buildSessionsCliPayload> | undefined,
) {
  if (command === 'watch') return undefined
  if (command === 'export' && arguments_.positionals[0] === 'watch') return undefined
  return resolvedPayload ?? buildSessionsCliPayload(command, arguments_)
}

export async function runSessionsCli(args: readonly string[]) {
  const parsed = parseMcpCliArguments(args)
  const command = parsed.positionals[0]
  const unresolvedArguments = { ...parsed, positionals: parsed.positionals.slice(1) }
  try {
    if (!command) {
      validateImplicitCliHelp('OpenWaggle Sessions', parsed)
      await writeCliStdout(`${sessionsCliUsage()}\n`)
      return EXIT.SUCCESS
    }
    validateSessionsCliOptions(command, unresolvedArguments)
    if (command === 'help') {
      await writeCliStdout(`${sessionsCliUsage()}\n`)
      return EXIT.SUCCESS
    }
    const resolvedInput = await resolveSessionsCliMessageInput(command, unresolvedArguments)
    const arguments_ = resolvedInput.arguments
    validateSessionsCliOutputMode({
      json: hasFlag(arguments_, 'json'),
      jsonl: hasFlag(arguments_, 'jsonl'),
      stream: isStreamingCommand(command, arguments_),
    })
    const payload = commandPayload(command, arguments_, resolvedInput.payload)
    const clientInput = await createLocalSessionCliClientInput(arguments_)
    return await runSessionCommand(command, arguments_, clientInput, payload)
  } catch (error) {
    const kind = writeSessionsCliError(
      error,
      hasFlag(unresolvedArguments, 'json') || hasFlag(unresolvedArguments, 'jsonl'),
    )
    return sessionCliExitCodeForError(kind)
  }
}
