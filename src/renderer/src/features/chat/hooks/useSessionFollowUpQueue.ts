import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationCommand,
  type SessionControlMutationResponse,
} from '@shared/types/session-control'
import type { SessionQueryOutcome } from '@shared/types/session-query'
import { THINKING_LEVELS } from '@shared/types/settings'
import { isRecord } from '@shared/utils/validation'
import { queryOptions, type UseQueryOptions, useQuery } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'

export interface SessionFollowUpQueueItem {
  readonly id: string
  readonly text: string
  readonly attachmentCount: number
  readonly createdAt: number
  readonly deliveryState: 'pending' | 'needs_attention'
  readonly attentionReason?:
    | 'authorization_ceiling_changed'
    | 'profile_revoked'
    | 'authority_changed'
  readonly wagglePresetName?: string
  readonly waggleSource?: 'user' | 'agent'
  readonly authorizationMode?: 'yolo' | 'ask-for-approval'
  readonly thinkingLevel?: AgentSendPayload['thinkingLevel']
  readonly callerId?: string
}

export interface SessionFollowUpQueueSnapshot {
  readonly state: 'running' | 'paused'
  readonly revision: number
  readonly activeRunId: string | null
  readonly items: readonly SessionFollowUpQueueItem[]
}

const EMPTY_SNAPSHOT: SessionFollowUpQueueSnapshot = {
  state: 'running',
  revision: 0,
  activeRunId: null,
  items: [],
}

function sessionFollowUpQueueKey(sessionId: SessionId | string) {
  return ['session-control', 'queue', String(sessionId)] as const
}

type SessionFollowUpQueueKey = readonly ['session-control', 'queue', string | null]

type SessionFollowUpQueueIntent = Pick<
  SessionFollowUpQueueItem,
  | 'text'
  | 'attachmentCount'
  | 'wagglePresetName'
  | 'waggleSource'
  | 'authorizationMode'
  | 'thinkingLevel'
  | 'callerId'
>

function queueIntent(value: unknown): SessionFollowUpQueueIntent {
  if (!isRecord(value)) {
    return { text: '', attachmentCount: 0 }
  }
  const record = value
  const waggle = isRecord(record.waggle) ? record.waggle : undefined
  const thinkingLevel = THINKING_LEVELS.find((level) => level === record.thinkingLevel)
  return {
    text: typeof record.text === 'string' ? record.text : '',
    attachmentCount: Array.isArray(record.attachmentIds) ? record.attachmentIds.length : 0,
    ...(waggle && typeof waggle.presetName === 'string'
      ? { wagglePresetName: waggle.presetName }
      : {}),
    ...(waggle && (waggle.source === 'user' || waggle.source === 'agent')
      ? { waggleSource: waggle.source }
      : {}),
    ...(record.runAuthorizationOverride === 'yolo' ||
    record.runAuthorizationOverride === 'ask-for-approval'
      ? { authorizationMode: record.runAuthorizationOverride }
      : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(typeof record.callerId === 'string' ? { callerId: record.callerId } : {}),
  }
}

function queueSnapshot(outcome: SessionQueryOutcome): SessionFollowUpQueueSnapshot {
  if (outcome.operation !== 'queue-list') {
    throw new Error('Session Host returned the wrong response for a Follow-up queue query.')
  }
  if ('error' in outcome) throw new Error(outcome.error.message)
  return {
    state: outcome.queueState,
    revision: outcome.queueRevision,
    activeRunId: outcome.activeRunId,
    items: outcome.items.map((item) => ({
      id: item.followUpId,
      ...queueIntent(item.intent),
      createdAt: item.createdAt,
      deliveryState: item.deliveryState,
      ...(item.attentionReason ? { attentionReason: item.attentionReason } : {}),
    })),
  }
}

async function readQueue(sessionId: SessionId) {
  const response = await api.querySessionControl({
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: crypto.randomUUID(),
    query: { operation: 'queue-list', sessionId, includeBodies: true },
  })
  return queueSnapshot(response.outcome)
}

function rejected(response: SessionControlMutationResponse) {
  return response.outcome.effect === 'rejected'
    ? new Error(`Session Control rejected ${response.outcome.operation}: ${response.outcome.code}`)
    : null
}

async function mutate(command: SessionControlMutationCommand) {
  const response = await api.mutateSessionControl({
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    command,
  })
  const error = rejected(response)
  if (error) throw error
  return response
}

export function sessionFollowUpQueueOptions(
  sessionId: SessionId | null,
): UseQueryOptions<
  SessionFollowUpQueueSnapshot,
  Error,
  SessionFollowUpQueueSnapshot,
  SessionFollowUpQueueKey
> {
  return queryOptions({
    queryKey: sessionId
      ? (sessionFollowUpQueueKey(sessionId) satisfies SessionFollowUpQueueKey)
      : (['session-control', 'queue', null] as const),
    queryFn: () => (sessionId ? readQueue(sessionId) : Promise.resolve(EMPTY_SNAPSHOT)),
    enabled: sessionId !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useSessionFollowUpQueue(sessionId: SessionId | null) {
  const query = useQuery(sessionFollowUpQueueOptions(sessionId))

  async function refresh() {
    if (!sessionId) return
    await query.refetch()
  }

  async function enqueue(payload: AgentSendPayload) {
    if (!sessionId) throw new Error('Select a Session before queueing a Follow-up.')
    await mutate({
      operation: 'follow-up',
      sessionId,
      input: {
        text: payload.text,
        thinkingLevel: payload.thinkingLevel,
        ...(payload.waggle ? { waggle: payload.waggle } : {}),
        attachmentIds: payload.attachments.map((attachment) => attachment.id),
      },
    })
    await refresh()
  }

  async function withdraw(followUpId: string) {
    if (!sessionId) return
    await mutate({ operation: 'queue-withdraw', sessionId, followUpIds: [followUpId] })
    await refresh()
  }

  async function promote(followUpId: string) {
    if (!sessionId) return
    const activeRunId = query.data?.activeRunId
    if (!activeRunId) throw new Error('The Session no longer has an active Run to steer.')
    await mutate({
      operation: 'promote',
      sessionId,
      expectedRunId: activeRunId,
      followUpId,
    })
    await refresh()
  }

  async function resubmitWithCurrentAccess(followUpId: string) {
    if (!sessionId) return
    try {
      const response = await mutate({
        operation: 'queue-update-authorization',
        sessionId,
        followUpId,
        runAuthorizationOverride: null,
      })
      if (response.outcome.effect !== 'queue-updated') return
      const repairedHead = response.outcome.followUpIds[0] === followUpId
      if (!repairedHead) return
      let queueRevision = response.outcome.queueRevision
      if (response.outcome.queueState === 'running') {
        const current = await readQueue(sessionId)
        if (
          current.activeRunId ||
          current.state !== 'running' ||
          current.items[0]?.id !== followUpId
        ) {
          return
        }
        queueRevision = current.revision
        const paused = await mutate({
          operation: 'queue-pause',
          sessionId,
          expectedQueueRevision: queueRevision,
        })
        if (paused.outcome.effect !== 'queue-updated') return
        queueRevision = paused.outcome.queueRevision
      }
      await mutate({
        operation: 'queue-resume',
        sessionId,
        expectedQueueRevision: queueRevision,
      })
    } finally {
      await refresh()
    }
  }

  async function setPaused(paused: boolean) {
    if (!sessionId) return
    const snapshot = query.data ?? (await readQueue(sessionId))
    await mutate({
      operation: paused ? 'queue-pause' : 'queue-resume',
      sessionId,
      expectedQueueRevision: snapshot.revision,
    })
    await refresh()
  }

  async function reorder(orderedFollowUpIds: readonly string[]) {
    if (!sessionId) return
    const snapshot = query.data ?? (await readQueue(sessionId))
    await mutate({
      operation: 'queue-reorder',
      sessionId,
      expectedQueueRevision: snapshot.revision,
      orderedFollowUpIds,
    })
    await refresh()
  }

  return {
    snapshot: query.data ?? EMPTY_SNAPSHOT,
    isLoading: query.isLoading,
    error: query.error,
    enqueue,
    withdraw,
    promote,
    resubmitWithCurrentAccess,
    setPaused,
    reorder,
    refresh,
  }
}
