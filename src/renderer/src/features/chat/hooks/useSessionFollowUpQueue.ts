import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationCommand,
  type SessionControlMutationResponse,
} from '@shared/types/session-control'
import { queryOptions, type UseQueryOptions, useQuery } from '@tanstack/react-query'
import {
  GUI_COMMAND_REQUIRES_IDLE_MESSAGE,
  isGuiOnlyComposerCommand,
} from '@/features/composer/commands'
import { api } from '@/shared/lib/ipc'
import { settledSessionModelWrites } from '../state/session-model-writes'
import {
  EMPTY_SNAPSHOT,
  queueSnapshot,
  SessionControlRejectedError,
  type SessionFollowUpEdit,
  type SessionFollowUpEditPayload,
  type SessionFollowUpQueueSnapshot,
} from './session-follow-up-queue-model'

export {
  isLostFollowUpEdit,
  SessionControlRejectedError,
  type SessionFollowUpEdit,
  type SessionFollowUpEditHold,
  type SessionFollowUpEditPayload,
  type SessionFollowUpQueueItem,
  type SessionFollowUpQueueSnapshot,
} from './session-follow-up-queue-model'

function sessionFollowUpQueueKey(sessionId: SessionId | string) {
  return ['session-control', 'queue', String(sessionId)] as const
}

type SessionFollowUpQueueKey = readonly ['session-control', 'queue', string | null]

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
    ? new SessionControlRejectedError(response.outcome.operation, response.outcome.code)
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
    if (isGuiOnlyComposerCommand(payload.text)) {
      throw new Error(GUI_COMMAND_REQUIRES_IDLE_MESSAGE)
    }
    // A queued follow-up runs with the Session model current when its Run starts; store a pick made
    // just before queueing first so the follow-up cannot start ahead of it.
    await settledSessionModelWrites(sessionId)
    await mutate({
      operation: 'follow-up',
      sessionId,
      input: {
        text: payload.text,
        thinkingLevel: payload.thinkingLevel,
        ...(payload.waggle ? { waggle: payload.waggle } : {}),
        attachmentIds: payload.attachments.map((attachment) => attachment.id),
        ...(payload.visualizationContext
          ? { visualizationContext: payload.visualizationContext }
          : {}),
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
    if (!sessionId) throw new Error('Select a Session before steering a Follow-up.')
    const item = query.data?.items.find((candidate) => candidate.id === followUpId)
    if (item && isGuiOnlyComposerCommand(item.text)) {
      throw new Error(
        'This command cannot steer a Run. Dismiss the queued command, wait for the active Run to finish, then submit it again.',
      )
    }
    const activeRunId = query.data?.activeRunId
    if (!activeRunId) throw new Error('The Session no longer has an active Run to steer.')
    const response = await mutate({
      operation: 'promote',
      sessionId,
      expectedRunId: activeRunId,
      followUpId,
    })
    if (response.outcome.effect !== 'promoted-follow-up') {
      throw new Error('Session Host returned the wrong response for a Follow-up promotion.')
    }
    await refresh()
    return response.outcome.receipt
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

  /**
   * Begins a Follow-up edit: the Host holds the item so the queue stops delivering at it, and
   * returns the item's current content to load into the composer. Throws a
   * `SessionControlRejectedError` when the item is gone, not this user's, or already being edited.
   */
  async function beginEdit(followUpId: string): Promise<SessionFollowUpEdit> {
    if (!sessionId) throw new Error('Select a Session before editing a queued message.')
    const response = await mutate({ operation: 'queue-edit-begin', sessionId, followUpId })
    if (response.outcome.effect !== 'follow-up-edit-held') {
      throw new Error('Session Host returned the wrong response for a Follow-up edit.')
    }
    const { holdId, leaseExpiresAt } = response.outcome
    const current = await readQueue(sessionId)
    const item = current.items.find((candidate) => candidate.id === followUpId)
    if (!item) {
      await cancelEdit({ followUpId, holdId }).catch(() => undefined)
      throw new SessionControlRejectedError('queue-edit-begin', 'follow_up_not_found')
    }
    await refresh()
    return { followUpId, holdId, leaseExpiresAt, item }
  }

  /**
   * Saves an open Follow-up edit in place (same identity and position) and releases its hold; the
   * queue then delivers again. GUI-only composer commands are refused like a new Follow-up. When
   * `isLostFollowUpEdit(error)` holds, the edit can no longer be saved and the draft should be kept.
   */
  async function saveEdit(
    edit: Pick<SessionFollowUpEdit, 'followUpId' | 'holdId'>,
    payload: SessionFollowUpEditPayload,
  ) {
    if (!sessionId) throw new Error('Select a Session before saving a queued message.')
    if (isGuiOnlyComposerCommand(payload.text)) {
      throw new Error(GUI_COMMAND_REQUIRES_IDLE_MESSAGE)
    }
    try {
      // Save against the latest revision: the guard is for concurrent queue changes, not for
      // whatever the queue looked like when the edit began.
      const current = await readQueue(sessionId)
      await mutate({
        operation: 'queue-edit-save',
        sessionId,
        followUpId: edit.followUpId,
        holdId: edit.holdId,
        expectedQueueRevision: current.revision,
        input: {
          text: payload.text,
          attachmentIds: payload.attachments.map((attachment) => attachment.id),
          ...(payload.waggle ? { waggle: payload.waggle } : {}),
          ...(payload.visualizationContext
            ? { visualizationContext: payload.visualizationContext }
            : {}),
        },
      })
    } finally {
      await refresh()
    }
  }

  /** Ends an open Follow-up edit without changing the item; releasing a lost hold succeeds. */
  async function cancelEdit(edit: Pick<SessionFollowUpEdit, 'followUpId' | 'holdId'>) {
    if (!sessionId) return
    try {
      await mutate({
        operation: 'queue-edit-cancel',
        sessionId,
        followUpId: edit.followUpId,
        holdId: edit.holdId,
      })
    } finally {
      await refresh()
    }
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
    beginEdit,
    saveEdit,
    cancelEdit,
    refresh,
  }
}
