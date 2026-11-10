import { isSessionlessHostEvent } from '@shared/types/session-host-event'
import { sessionIdsFromReferences } from '@shared/utils/session-link'
import { asUsageErrors, asUsageErrorsSync } from './cli-error'
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
import { runAgentDefinitionDiscoveryCommand } from './sessions-cli-agent-definitions'
import { requiredSessionId, watchCursor } from './sessions-cli-arguments'
import { streamSessionExport } from './sessions-cli-export'
import { watchSessionExportOperations } from './sessions-cli-export-operation'
import {
  hiveHostInputPlaceholder,
  type PreparedHiveHostInput,
  prepareHiveHostInput,
  resolveHiveHostInput,
} from './sessions-cli-host-input'
import {
  readCliStdin,
  readUtf8File,
  resolveSessionsCliMessageInput,
} from './sessions-cli-message-input'
import { isLocalHiveCliCommand, validateSessionsCliOptions } from './sessions-cli-option-contract'
import {
  validateSessionsCliOutputMode,
  writeSessionsCliError,
  writeSessionsCliResponse,
  writeSessionsCliStreamRecord,
} from './sessions-cli-output'
import { buildSessionsCliPayload } from './sessions-cli-payload'
import { streamFullTranscript } from './sessions-cli-transcript'
import { sessionsCliUsage } from './sessions-cli-usage'
import {
  watchCursorRecord,
  watchEventRecord,
  watchResyncRecord,
} from './sessions-cli-watch-records'

export { buildSessionsCliPayload } from './sessions-cli-payload'

type ClientInput = Awaited<ReturnType<typeof createLocalSessionCliClientInput>>

async function runWatchCommand(
  arguments_: ReturnType<typeof parseMcpCliArguments>,
  clientInput: ClientInput,
) {
  const sessionIds = new Set(sessionIdsFromReferences(arguments_.positionals, 'Session ID'))
  const abortController = new AbortController()
  const interrupt = () => abortController.abort()
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    const after = watchCursor(arguments_)
    const jsonl = hasFlag(arguments_, 'jsonl')
    const writeCursor = (cursor: { readonly hostInstanceId: string; readonly sequence: number }) =>
      writeSessionsCliStreamRecord(watchCursorRecord(cursor), jsonl)
    const result = await watchLocalSessionEvents({
      ...clientInput,
      ...(after ? { after } : {}),
      ...(sessionIds.size > 0 ? { sessionIds: [...sessionIds] } : {}),
      signal: abortController.signal,
      onCursor: writeCursor,
      onEvent: async (event) => {
        if (
          sessionIds.size > 0 &&
          (isSessionlessHostEvent(event.payload) || !sessionIds.has(event.payload.sessionId))
        ) {
          await writeCursor(event.cursor)
          return
        }
        await writeSessionsCliStreamRecord(watchEventRecord(event), jsonl)
      },
    })
    if (result.status === 'resync-required') {
      await writeSessionsCliStreamRecord(watchResyncRecord(result), jsonl)
      return EXIT.RESYNC_REQUIRED
    }
    return EXIT.SUCCESS
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
  }
}

async function runSessionCommand(
  command: string,
  arguments_: ReturnType<typeof parseMcpCliArguments>,
  clientInput: ClientInput,
  payload: ReturnType<typeof buildSessionsCliPayload> | undefined,
) {
  if (command === 'watch') return runWatchCommand(arguments_, clientInput)
  if (command === 'exports-watch') {
    const result = await watchSessionExportOperations(arguments_, clientInput)
    return result.status === 'resync-required' ? EXIT.RESYNC_REQUIRED : EXIT.SUCCESS
  }
  const result = await executeLocalSessionCommand({
    ...clientInput,
    payload: payload ?? buildSessionsCliPayload(command, arguments_),
  })
  const resultError = sessionCliResultErrorKind(result)
  if (resultError) {
    await writeSessionsCliResponse(`hive ${command}`, result, hasFlag(arguments_, 'json'))
    return sessionCliExitCodeForError(resultError)
  }
  if (command === 'read' && hasFlag(arguments_, 'full')) {
    const sessionId = requiredSessionId(arguments_.positionals[0])
    await streamFullTranscript({
      sessionId,
      session: result,
      clientInput,
      jsonl: hasFlag(arguments_, 'jsonl'),
      arguments: arguments_,
    })
    return EXIT.SUCCESS
  }
  if (command === 'export') {
    await streamSessionExport({
      sessionId: requiredSessionId(arguments_.positionals[0]),
      firstResult: result,
      clientInput,
      arguments: arguments_,
    })
    return EXIT.SUCCESS
  }
  await writeSessionsCliResponse(`hive ${command}`, result, hasFlag(arguments_, 'json'))
  return EXIT.SUCCESS
}

/**
 * Reads what `request-respond` and the amendment commands build on, then builds their request. A
 * refused read fails with the refusal's error kind and exit code.
 */
async function resolveHostPayload(
  command: string,
  arguments_: ReturnType<typeof parseMcpCliArguments>,
  clientInput: ClientInput,
  prepared: PreparedHiveHostInput,
) {
  const structured = await resolveHiveHostInput(prepared, arguments_, (payload) =>
    executeLocalSessionCommand({ ...clientInput, payload }),
  )
  return asUsageErrorsSync(() => buildSessionsCliPayload(command, arguments_, { structured }))
}

function isStreamingCommand(command: string, arguments_: ReturnType<typeof parseMcpCliArguments>) {
  if (command === 'watch' || command === 'exports-watch' || command === 'export') return true
  return command === 'read' && hasFlag(arguments_, 'full')
}

function commandPayload(
  command: string,
  arguments_: ReturnType<typeof parseMcpCliArguments>,
  resolvedPayload: ReturnType<typeof buildSessionsCliPayload> | undefined,
  prepared: PreparedHiveHostInput | undefined,
) {
  // Built once the Session Host state it needs has been read (resolveHostPayload).
  if (prepared) return undefined
  if (command === 'watch' || command === 'exports-watch') {
    // Streams build their requests later; read their arguments now, with the other usage checks.
    watchCursor(arguments_)
    if (command === 'watch') sessionIdsFromReferences(arguments_.positionals, 'Session ID')
    else requiredSessionId(arguments_.positionals[0])
    return undefined
  }
  return resolvedPayload ?? buildSessionsCliPayload(command, arguments_)
}

export async function runSessionsCli(args: readonly string[]) {
  const parsed = parseMcpCliArguments(args)
  const command = parsed.positionals[0]
  const unresolvedArguments = { ...parsed, positionals: parsed.positionals.slice(1) }
  try {
    if (!command) {
      validateImplicitCliHelp('OpenWaggle Hive', parsed)
      await writeCliStdout(`${sessionsCliUsage()}\n`)
      return EXIT.SUCCESS
    }
    asUsageErrorsSync(() => validateSessionsCliOptions(command, unresolvedArguments))
    if (command === 'help') {
      await writeCliStdout(`${sessionsCliUsage()}\n`)
      return EXIT.SUCCESS
    }
    if (isLocalHiveCliCommand(command)) {
      return await runAgentDefinitionDiscoveryCommand(command, unresolvedArguments)
    }
    // Reading the command line: whatever it rejects is a usage error (exit 2).
    const { arguments_, payload, prepared } = await asUsageErrors(async () => {
      const resolvedInput = await resolveSessionsCliMessageInput(command, unresolvedArguments)
      validateSessionsCliOutputMode({
        json: hasFlag(resolvedInput.arguments, 'json'),
        jsonl: hasFlag(resolvedInput.arguments, 'jsonl'),
        stream: isStreamingCommand(command, resolvedInput.arguments),
      })
      // Check the rest of the command line before reading an answer or connecting, with
      // placeholders for what the Session Host read supplies.
      const placeholder = hiveHostInputPlaceholder(command)
      if (placeholder) {
        buildSessionsCliPayload(command, resolvedInput.arguments, { structured: placeholder })
      }
      const hostInput = await prepareHiveHostInput(command, resolvedInput.arguments, {
        stdin: readCliStdin,
        file: (filePath) => readUtf8File(filePath),
      })
      return {
        arguments_: resolvedInput.arguments,
        prepared: hostInput,
        payload: commandPayload(command, resolvedInput.arguments, resolvedInput.payload, hostInput),
      }
    })
    const clientInput = await createLocalSessionCliClientInput(arguments_)
    if (!prepared) return await runSessionCommand(command, arguments_, clientInput, payload)
    const resolved = await resolveHostPayload(command, arguments_, clientInput, prepared)
    return await runSessionCommand(command, arguments_, clientInput, resolved)
  } catch (error) {
    const kind = writeSessionsCliError(
      error,
      hasFlag(unresolvedArguments, 'json') || hasFlag(unresolvedArguments, 'jsonl'),
    )
    return sessionCliExitCodeForError(kind)
  }
}
