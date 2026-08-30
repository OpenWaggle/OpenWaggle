import { randomUUID } from 'node:crypto'
import { decodeLocalSessionCommandPayload } from '@shared/schemas/local-session-protocol'
import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import {
  LOCAL_SESSION_DEFAULT_CLIENT_TIMEOUT_MS,
  type LocalSessionClientConnectionInput,
  openLocalSessionConnection,
  writeLocalSessionFrame,
} from './local-session-client-connection'
import { decodeLocalSessionCommandResponse } from './local-session-client-response'

export {
  type LocalSessionClientConnectionInput,
  LocalSessionHostUpgradePendingError,
} from './local-session-client-connection'
export {
  type LocalSessionWatchResult,
  watchLocalSessionEvents,
} from './local-session-event-client'

const LONG_RUNNING_COMMAND_GRACE_MS = 5_000

function requiresCurrentProtocolRevision(payload: LocalSessionCommandPayload) {
  return payload.contract === 'session-waggle-v1' || payload.contract === 'session-waggle-cancel-v1'
}

function requestedWaitTimeoutMs(payload: LocalSessionCommandPayload) {
  if (payload.contract !== 'session-query-v2') return undefined
  const query = payload.request.query
  if (query.operation === 'wait' || query.operation === 'exports-wait') return query.timeoutMs
  return query.operation === 'search' ? query.waitTimeoutMs : undefined
}

export function resolveLocalSessionCommandTimeoutMs(
  payload: LocalSessionCommandPayload,
  explicitTimeoutMs?: number,
) {
  if (payload.contract === 'session-waggle-v1') return explicitTimeoutMs
  const requestedWait = requestedWaitTimeoutMs(payload)
  const commandMinimum =
    requestedWait === undefined
      ? LOCAL_SESSION_DEFAULT_CLIENT_TIMEOUT_MS
      : requestedWait + LONG_RUNNING_COMMAND_GRACE_MS
  return Math.max(explicitTimeoutMs ?? LOCAL_SESSION_DEFAULT_CLIENT_TIMEOUT_MS, commandMinimum)
}

export async function executeLocalSessionCommand(input: {
  readonly paths: LocalSessionClientConnectionInput['paths']
  readonly payload: LocalSessionCommandPayload
  readonly clientKind?: LocalSessionClientConnectionInput['clientKind']
  readonly clientVersion: string
  readonly workingDirectory?: string
  readonly profile?: string
  readonly profileCredential?: string
  readonly timeoutMs?: number
  readonly supportedRevisions?: readonly number[]
}): Promise<LocalSessionCommandResult> {
  const responseTimeoutMs = resolveLocalSessionCommandTimeoutMs(input.payload, input.timeoutMs)
  const supportedRevisions =
    input.supportedRevisions ??
    (requiresCurrentProtocolRevision(input.payload) ? [LOCAL_SESSION_CURRENT_REVISION] : undefined)
  const { socket, reader, negotiation } = await openLocalSessionConnection({
    ...input,
    ...(supportedRevisions ? { supportedRevisions } : {}),
  })
  try {
    if (
      requiresCurrentProtocolRevision(input.payload) &&
      negotiation.revision < LOCAL_SESSION_CURRENT_REVISION
    ) {
      throw new Error('The connected Session Host does not support explicit Waggle commands.')
    }
    const requestId = randomUUID()
    await writeLocalSessionFrame(socket, {
      kind: 'command',
      requestId,
      payload: decodeLocalSessionCommandPayload(input.payload),
    })
    return decodeLocalSessionCommandResponse(await reader.next(responseTimeoutMs), requestId)
  } finally {
    socket.destroy()
  }
}

export async function probeLocalSessionHost(input: LocalSessionClientConnectionInput) {
  const connection = await openLocalSessionConnection(input)
  connection.socket.destroy()
  return connection.negotiation
}
