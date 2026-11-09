import type { LocalSessionCliClientInput } from './local-session-cli-client'
import { hasFlag, type ParsedArguments } from './mcp-cli-arguments'
import { watchLocalSessionEvents } from './session-host/local-session-client'
import { requiredSessionId, watchCursor } from './sessions-cli-arguments'
import { writeSessionsCliStreamRecord } from './sessions-cli-output'
import {
  watchCursorRecord,
  watchEventRecord,
  watchResyncRecord,
} from './sessions-cli-watch-records'

const EXPORT_OPERATION_ID_POSITION = 1

export async function watchSessionExportOperations(
  arguments_: ParsedArguments,
  clientInput: LocalSessionCliClientInput,
) {
  const sessionId = requiredSessionId(arguments_.positionals[0])
  const exportOperationId = arguments_.positionals[EXPORT_OPERATION_ID_POSITION]
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
      sessionIds: [sessionId],
      ...(after ? { after } : {}),
      signal: abortController.signal,
      onCursor: writeCursor,
      onEvent: async (event) => {
        const payload = event.payload
        if (
          payload.kind !== 'session-export-changed' ||
          payload.sessionId !== sessionId ||
          (exportOperationId && payload.exportOperationId !== exportOperationId)
        ) {
          await writeCursor(event.cursor)
          return
        }
        await writeSessionsCliStreamRecord(watchEventRecord(event), jsonl)
      },
    })
    if (result.status === 'resync-required') {
      await writeSessionsCliStreamRecord(watchResyncRecord(result), jsonl)
    }
    return result
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
  }
}
