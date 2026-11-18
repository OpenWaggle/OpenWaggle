import type { LocalSessionCliClientInput } from './local-session-cli-client'
import type { ParsedArguments } from './mcp-cli-arguments'
import { requiredSessionId } from './sessions-cli-arguments'
import { streamSessionsCliWatch } from './sessions-cli-watch-stream'

const EXPORT_OPERATION_ID_POSITION = 1

export async function watchSessionExportOperations(
  arguments_: ParsedArguments,
  clientInput: LocalSessionCliClientInput,
) {
  const sessionId = requiredSessionId(arguments_.positionals[0])
  const exportOperationId = arguments_.positionals[EXPORT_OPERATION_ID_POSITION]
  return streamSessionsCliWatch({
    arguments_,
    clientInput,
    sessionIds: [sessionId],
    includeEvent: (event) =>
      event.payload.kind === 'session-export-changed' &&
      event.payload.sessionId === sessionId &&
      (!exportOperationId || event.payload.exportOperationId === exportOperationId),
  })
}
