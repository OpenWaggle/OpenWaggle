import { randomUUID } from 'node:crypto'
import {
  isFollowUpEditCommand,
  requiredLocalSessionCommandRevision,
} from '@shared/schemas/local-session-command-revision'
import { decodeLocalSessionCommandPayload } from '@shared/schemas/local-session-protocol'
import {
  LOCAL_SESSION_SUPPORTED_REVISIONS,
  type LocalSessionCommandPayload,
  type LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
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

function unsupportedRevisionMessage(payload: LocalSessionCommandPayload) {
  if (isFollowUpEditCommand(payload)) {
    return 'The connected Session Host does not support editing queued messages.'
  }
  if (payload.contract === 'local-update-v1') {
    return 'The connected Session Host does not support update channel commands.'
  }
  if (payload.contract === 'local-host-v1') {
    return 'The connected Session Host does not support being stopped from the CLI.'
  }
  if (payload.contract === 'desktop-service-v1')
    return 'The connected Session Host does not support desktop services.'
  if (payload.contract === 'session-control-v2') {
    return payload.request.command.operation === 'queue-adopt'
      ? 'The connected Session Host does not support sending a queued message as yourself.'
      : 'The connected Session Host does not support steering delivery receipts.'
  }
  if (payload.contract === 'host-ui-v1') {
    return 'The connected Session Host does not support Host UI requests.'
  }
  return payload.contract === 'local-compaction-v1' ||
    payload.contract === 'local-compaction-cancel-v1'
    ? 'The connected Session Host does not support manual compaction.'
    : 'The connected Session Host does not support explicit Waggle commands.'
}

/**
 * The revisions this client offers for a command: those at or above the revision the Host requires
 * to decode it (`requiredLocalSessionCommandRevision`, the rule the Host itself applies).
 */
export function supportedRevisionsForCommand(payload: LocalSessionCommandPayload) {
  const minimum = requiredLocalSessionCommandRevision(payload)
  if (minimum === undefined) return undefined
  return LOCAL_SESSION_SUPPORTED_REVISIONS.filter((revision) => revision >= minimum)
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
  if (
    payload.contract === 'session-waggle-v1' ||
    payload.contract === 'local-compaction-v1' ||
    payload.contract === 'host-ui-v1' ||
    (payload.contract === 'session-control-v2' &&
      (payload.request.command.operation === 'steer' ||
        payload.request.command.operation === 'promote'))
  ) {
    return explicitTimeoutMs
  }
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
  const supportedRevisions = input.supportedRevisions ?? supportedRevisionsForCommand(input.payload)
  const { socket, reader, negotiation } = await openLocalSessionConnection({
    ...input,
    ...(supportedRevisions ? { supportedRevisions } : {}),
  })
  try {
    const minimumRevision = requiredLocalSessionCommandRevision(input.payload)
    if (minimumRevision !== undefined && negotiation.revision < minimumRevision) {
      throw new Error(unsupportedRevisionMessage(input.payload))
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
