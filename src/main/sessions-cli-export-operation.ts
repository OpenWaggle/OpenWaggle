import type { LocalSessionCliClientInput } from './local-session-cli-client'
import type { ParsedArguments } from './mcp-cli-arguments'
import { watchLocalSessionEvents } from './session-host/local-session-client'
import { required, watchCursor } from './sessions-cli-arguments'

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
    return await watchLocalSessionEvents({
      ...clientInput,
      ...(after ? { after } : {}),
      signal: abortController.signal,
      onEvent: (event) => {
        const payload = event.payload
        if (payload.kind !== 'session-export-changed' || payload.sessionId !== sessionId) return
        if (exportOperationId && payload.exportOperationId !== exportOperationId) return
        process.stdout.write(`${JSON.stringify(event)}\n`)
      },
    })
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
  }
}
