import type { LocalSessionCliClientInput } from './local-session-cli-client'
import { hasFlag, type ParsedArguments } from './mcp-cli-arguments'
import { watchLocalSessionEvents } from './session-host/local-session-client'
import { required, watchCursor } from './sessions-cli-arguments'
import { writeSessionsCliStreamRecord } from './sessions-cli-output'

const EXPORT_OPERATION_ID_POSITION = 2

export async function watchSessionExportOperations(
  arguments_: ParsedArguments,
  clientInput: LocalSessionCliClientInput,
) {
  const sessionId = required(arguments_.positionals[1], 'Session ID')
  const exportOperationId = arguments_.positionals[EXPORT_OPERATION_ID_POSITION]
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
      onEvent: (event) => {
        const payload = event.payload
        if (
          payload.kind !== 'session-export-changed' ||
          payload.sessionId !== sessionId ||
          (exportOperationId && payload.exportOperationId !== exportOperationId)
        ) {
          writeCursor(event.cursor)
          return
        }
        writeSessionsCliStreamRecord(event, jsonl)
      },
    })
    if (result.status === 'resync-required') writeSessionsCliStreamRecord(result, jsonl)
    return result
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
  }
}
