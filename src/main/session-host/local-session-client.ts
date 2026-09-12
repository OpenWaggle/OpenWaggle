import { randomUUID } from 'node:crypto'
import { decodeLocalSessionCommandPayload } from '@shared/schemas/local-session-protocol'
import {
  HOST_BACKED_MCP_GUI_CHANNELS,
  HOST_UI_REVISION_7_REQUIRED_CHANNELS,
  HOST_UI_REVISION_9_REQUIRED_CHANNELS,
  HOST_UI_REVISION_10_REQUIRED_CHANNELS,
  HOST_UI_REVISION_11_REQUIRED_CHANNELS,
} from '@shared/types/host-ui-protocol'
import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import {
  LOCAL_SESSION_AUTHORIZATION_GRANTS_REVISION,
  LOCAL_SESSION_COMPACTION_REVISION,
  LOCAL_SESSION_DESKTOP_SERVICE_REVISION,
  LOCAL_SESSION_LEGACY_HOST_UI_REVISION,
  LOCAL_SESSION_MCP_AUTH_REVISION,
  LOCAL_SESSION_MCP_HOST_UI_REVISION,
  LOCAL_SESSION_STEERING_RECEIPT_REVISION,
  LOCAL_SESSION_SUPPORTED_REVISIONS,
  LOCAL_SESSION_WAGGLE_REVISION,
  LOCAL_SESSION_WORKSPACE_AUTHORIZATION_REVISION,
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

function minimumProtocolRevision(payload: LocalSessionCommandPayload) {
  if (payload.contract === 'desktop-service-v1') return LOCAL_SESSION_DESKTOP_SERVICE_REVISION
  if (
    payload.contract === 'session-control-v2' &&
    (payload.request.command.operation === 'steer' ||
      payload.request.command.operation === 'promote')
  ) {
    return LOCAL_SESSION_STEERING_RECEIPT_REVISION
  }
  if (
    payload.contract === 'local-compaction-v1' ||
    payload.contract === 'local-compaction-cancel-v1'
  ) {
    return LOCAL_SESSION_COMPACTION_REVISION
  }
  if (payload.contract === 'host-ui-v1') {
    if (
      HOST_UI_REVISION_11_REQUIRED_CHANNELS.some((channel) => channel === payload.request.channel)
    ) {
      return LOCAL_SESSION_DESKTOP_SERVICE_REVISION
    }
    if (
      HOST_UI_REVISION_10_REQUIRED_CHANNELS.some((channel) => channel === payload.request.channel)
    ) {
      return LOCAL_SESSION_AUTHORIZATION_GRANTS_REVISION
    }
    if (
      HOST_UI_REVISION_9_REQUIRED_CHANNELS.some((channel) => channel === payload.request.channel)
    ) {
      return LOCAL_SESSION_WORKSPACE_AUTHORIZATION_REVISION
    }
    if (
      HOST_UI_REVISION_7_REQUIRED_CHANNELS.some((channel) => channel === payload.request.channel)
    ) {
      return LOCAL_SESSION_MCP_AUTH_REVISION
    }
    return HOST_BACKED_MCP_GUI_CHANNELS.some((channel) => channel === payload.request.channel)
      ? LOCAL_SESSION_MCP_HOST_UI_REVISION
      : LOCAL_SESSION_LEGACY_HOST_UI_REVISION
  }
  if (payload.contract === 'session-waggle-v1' || payload.contract === 'session-waggle-cancel-v1') {
    return LOCAL_SESSION_WAGGLE_REVISION
  }
  return undefined
}

function unsupportedRevisionMessage(payload: LocalSessionCommandPayload) {
  if (payload.contract === 'desktop-service-v1')
    return 'The connected Session Host does not support desktop services.'
  if (payload.contract === 'session-control-v2') {
    return 'The connected Session Host does not support steering delivery receipts.'
  }
  if (payload.contract === 'host-ui-v1') {
    return 'The connected Session Host does not support Host UI requests.'
  }
  return payload.contract === 'local-compaction-v1' ||
    payload.contract === 'local-compaction-cancel-v1'
    ? 'The connected Session Host does not support manual compaction.'
    : 'The connected Session Host does not support explicit Waggle commands.'
}

export function supportedRevisionsForCommand(payload: LocalSessionCommandPayload) {
  const minimum = minimumProtocolRevision(payload)
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
    const minimumRevision = minimumProtocolRevision(input.payload)
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
