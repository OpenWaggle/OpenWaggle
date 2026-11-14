import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import type { LocalSessionCliClientInput } from './local-session-cli-client'
import { hasFlag, type ParsedArguments } from './mcp-cli-arguments'
import { watchLocalSessionEvents } from './session-host/local-session-client'
import { watchCursor } from './sessions-cli-arguments'
import { writeSessionsCliStreamRecord } from './sessions-cli-output'
import {
  watchCursorRecord,
  watchEventRecord,
  watchResyncRecord,
} from './sessions-cli-watch-records'

/**
 * Streams Session Host events as watch records until SIGINT or SIGTERM, starting after the
 * `--after` cursor. An event `includeEvent` rejects is written as a cursor record only, so a
 * consumer can still resume after it. Returns the watch result; a resync was already written.
 */
export async function streamSessionsCliWatch(input: {
  readonly arguments_: ParsedArguments
  readonly clientInput: LocalSessionCliClientInput
  readonly sessionIds: readonly string[]
  readonly includeEvent: (event: SessionHostEventEnvelope) => boolean
}) {
  const abortController = new AbortController()
  const interrupt = () => abortController.abort()
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    const after = watchCursor(input.arguments_)
    const jsonl = hasFlag(input.arguments_, 'jsonl')
    const writeCursor = (cursor: { readonly hostInstanceId: string; readonly sequence: number }) =>
      writeSessionsCliStreamRecord(watchCursorRecord(cursor), jsonl)
    const result = await watchLocalSessionEvents({
      ...input.clientInput,
      ...(after ? { after } : {}),
      ...(input.sessionIds.length > 0 ? { sessionIds: input.sessionIds } : {}),
      signal: abortController.signal,
      onCursor: writeCursor,
      onEvent: async (event) => {
        if (!input.includeEvent(event)) {
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
