import { match } from '@diegogbrisa/ts-match'
import { decodeLocalSessionProfileManagementResponse } from '@shared/schemas/local-session-profile-management'
import { decodeSessionControlMutationResponse } from '@shared/schemas/session-control'
import { decodeSessionLifecycleResponse } from '@shared/schemas/session-lifecycle'
import {
  type LocalSessionCommandResult,
  SESSION_WAGGLE_CONTRACT_VERSION,
} from '@shared/types/local-session-protocol'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  type SessionQueryResponse,
} from '@shared/types/session-query'
import { isRecord } from './local-session-client-connection'

function isPreparedAttachment(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.kind === 'text' || value.kind === 'image' || value.kind === 'pdf') &&
    (value.origin === undefined ||
      value.origin === 'user-file' ||
      value.origin === 'auto-paste-text') &&
    typeof value.name === 'string' &&
    typeof value.path === 'string' &&
    typeof value.mimeType === 'string' &&
    typeof value.sizeBytes === 'number' &&
    typeof value.extractedText === 'string'
  )
}

function isLocalAttachmentsResponse(
  value: unknown,
): value is Extract<LocalSessionCommandResult, { contract: 'local-attachments-v1' }>['response'] {
  return (
    isRecord(value) &&
    typeof value.requestId === 'string' &&
    Array.isArray(value.attachments) &&
    value.attachments.every(isPreparedAttachment)
  )
}

function isLocalUiResponse(
  value: unknown,
): value is Extract<LocalSessionCommandResult, { contract: 'local-ui-v1' }>['response'] {
  return (
    isRecord(value) &&
    typeof value.requestId === 'string' &&
    typeof value.effect === 'string' &&
    [
      'pinned',
      'unpinned',
      'pin-moved',
      'interrupted-run-dismissed',
      'tree-navigated',
      'branch-renamed',
      'branch-archived',
      'branch-restored',
      'tree-ui-state-updated',
      'session-deleted',
    ].includes(value.effect) &&
    typeof value.sessionId === 'string' &&
    (value.navigation === undefined ||
      (isRecord(value.navigation) && typeof value.navigation.cancelled === 'boolean'))
  )
}

function isSessionQueryResponse(value: unknown): value is SessionQueryResponse {
  return (
    isRecord(value) &&
    value.contractVersion === SESSION_QUERY_CONTRACT_VERSION &&
    typeof value.requestId === 'string' &&
    isRecord(value.outcome) &&
    typeof value.outcome.operation === 'string'
  )
}

function isAgentSendReport(value: unknown) {
  return (
    isRecord(value) &&
    (value.outcome === 'delivered' ||
      value.outcome === 'refused' ||
      value.outcome === 'cancelled') &&
    (value.message === undefined || typeof value.message === 'string') &&
    (value.code === undefined || typeof value.code === 'string')
  )
}

function isSessionWaggleResponse(
  value: unknown,
): value is Extract<LocalSessionCommandResult, { contract: 'session-waggle-v1' }>['response'] {
  return (
    isRecord(value) &&
    value.contractVersion === SESSION_WAGGLE_CONTRACT_VERSION &&
    typeof value.requestId === 'string' &&
    typeof value.idempotencyKey === 'string' &&
    typeof value.replayed === 'boolean' &&
    isAgentSendReport(value.report)
  )
}

function isSessionWaggleCancellationResponse(
  value: unknown,
): value is Extract<
  LocalSessionCommandResult,
  { contract: 'session-waggle-cancel-v1' }
>['response'] {
  return (
    isRecord(value) &&
    value.contractVersion === SESSION_WAGGLE_CONTRACT_VERSION &&
    typeof value.requestId === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.cancelled === 'boolean'
  )
}

function isContextCompactionResult(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.summary === 'string' &&
    typeof value.firstKeptEntryId === 'string' &&
    typeof value.tokensBefore === 'number'
  )
}

function isLocalCompactionResponse(
  value: unknown,
): value is Extract<LocalSessionCommandResult, { contract: 'local-compaction-v1' }>['response'] {
  return (
    isRecord(value) &&
    typeof value.requestId === 'string' &&
    typeof value.sessionId === 'string' &&
    isContextCompactionResult(value.result)
  )
}

function isLocalCompactionCancellationResponse(
  value: unknown,
): value is Extract<
  LocalSessionCommandResult,
  { contract: 'local-compaction-cancel-v1' }
>['response'] {
  return (
    isRecord(value) &&
    typeof value.requestId === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.cancelled === 'boolean'
  )
}

function decodeCommandPayload(payload: Record<string, unknown>): LocalSessionCommandResult {
  return match(payload.contract)
    .with('local-attachments-v1', () => {
      if (!isLocalAttachmentsResponse(payload.response)) throw new Error('Invalid attachments.')
      return { contract: 'local-attachments-v1' as const, response: payload.response }
    })
    .with('local-ui-v1', () => {
      if (!isLocalUiResponse(payload.response)) throw new Error('Invalid Local UI response.')
      return { contract: 'local-ui-v1' as const, response: payload.response }
    })
    .with('local-access-v1', () => ({
      contract: 'local-access-v1' as const,
      response: decodeLocalSessionProfileManagementResponse(payload.response),
    }))
    .with('session-control-v2', () => ({
      contract: 'session-control-v2' as const,
      response: decodeSessionControlMutationResponse(payload.response),
    }))
    .with('session-lifecycle-v2', () => ({
      contract: 'session-lifecycle-v2' as const,
      response: decodeSessionLifecycleResponse(payload.response),
    }))
    .with('session-query-v2', () => {
      if (!isSessionQueryResponse(payload.response)) throw new Error('Invalid query response.')
      return { contract: 'session-query-v2' as const, response: payload.response }
    })
    .with('session-waggle-v1', () => {
      if (!isSessionWaggleResponse(payload.response)) throw new Error('Invalid Waggle response.')
      return { contract: 'session-waggle-v1' as const, response: payload.response }
    })
    .with('session-waggle-cancel-v1', () => {
      if (!isSessionWaggleCancellationResponse(payload.response)) {
        throw new Error('Invalid Waggle cancellation response.')
      }
      return { contract: 'session-waggle-cancel-v1' as const, response: payload.response }
    })
    .with('local-compaction-v1', () => {
      if (!isLocalCompactionResponse(payload.response)) {
        throw new Error('Invalid Local compaction response.')
      }
      return { contract: 'local-compaction-v1' as const, response: payload.response }
    })
    .with('local-compaction-cancel-v1', () => {
      if (!isLocalCompactionCancellationResponse(payload.response)) {
        throw new Error('Invalid Local compaction cancellation response.')
      }
      return { contract: 'local-compaction-cancel-v1' as const, response: payload.response }
    })
    .otherwise(() => {
      throw new Error('Local Session Host returned an invalid command contract.')
    })
}

export function decodeLocalSessionCommandResponse(
  frame: unknown,
  requestId: string,
): LocalSessionCommandResult {
  if (!isRecord(frame) || typeof frame.kind !== 'string') {
    throw new Error('Local Session Host returned an invalid command frame.')
  }
  if (frame.kind === 'error') {
    throw new Error(
      typeof frame.message === 'string' ? frame.message : 'Local Session command failed.',
    )
  }
  if (frame.kind !== 'response' || frame.requestId !== requestId) {
    throw new Error('Local Session Host returned an unexpected command response.')
  }
  if (!isRecord(frame.payload) || !('response' in frame.payload)) {
    throw new Error('Local Session Host returned an invalid command payload.')
  }
  return decodeCommandPayload(frame.payload)
}
