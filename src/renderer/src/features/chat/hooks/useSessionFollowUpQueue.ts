import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import { queryOptions, type UseQueryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  GUI_COMMAND_REQUIRES_IDLE_MESSAGE,
  isGuiOnlyComposerCommand,
} from '@/features/composer/commands'
import { settledSessionModelWrites } from '../state/session-model-writes'
import { adoptHeldEdit, mutate, readQueue } from './session-follow-up-queue-client'
import {
  EMPTY_SNAPSHOT,
  heldEdit,
  SessionControlRejectedError,
  type SessionFollowUpEdit,
  type SessionFollowUpEditPayload,
  type SessionFollowUpQueueSnapshot,
} from './session-follow-up-queue-model'

export {
  heldEdit,
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
  const queryClient = useQueryClient()
  const query = useQuery(sessionFollowUpQueueOptions(sessionId))

  async function refresh() {
    if (!sessionId) return undefined
    const result = await query.refetch()
    return result.data
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

  /**
   * Reorders the whole queue. Guarded by `expectedQueueRevision` (default: the loaded snapshot's);
   * a stale guard rejects with `queue_revision_changed`.
   */
  async function reorder(orderedFollowUpIds: readonly string[], expectedQueueRevision?: number) {
    if (!sessionId) return
    const revision = expectedQueueRevision ?? (query.data ?? (await readQueue(sessionId))).revision
    await mutate({
      operation: 'queue-reorder',
      sessionId,
      expectedQueueRevision: revision,
      orderedFollowUpIds,
    })
    await refresh()
  }

  /**
   * Begins a Follow-up edit: the Host holds the item so the queue stops delivering at it, and
   * returns the item's current content to load into the composer. Throws a
   * `SessionControlRejectedError` when the item is gone, not this user's, or already being edited.
   * If the content cannot be read after the hold was acquired, the hold is released again.
   */
  async function beginEdit(followUpId: string): Promise<SessionFollowUpEdit> {
    if (!sessionId) throw new Error('Select a Session before editing a queued message.')
    const response = await mutate({ operation: 'queue-edit-begin', sessionId, followUpId })
    if (response.outcome.effect !== 'follow-up-edit-held') {
      throw new Error('Session Host returned the wrong response for a Follow-up edit.')
    }
    const { holdId, leaseExpiresAt, queueRevision } = response.outcome
    const edit = { followUpId, holdId, queueRevision }
    let item: SessionFollowUpEdit['item'] | undefined
    try {
      const current = await readQueue(sessionId)
      item = current.items.find((candidate) => candidate.id === followUpId)
    } catch (error) {
      await cancelEdit(edit).catch(() => undefined)
      throw error
    }
    if (!item) {
      await cancelEdit(edit).catch(() => undefined)
      throw new SessionControlRejectedError('queue-edit-begin', 'follow_up_not_found')
    }
    await refresh()
    return { ...edit, leaseExpiresAt, item }
  }

  /**
   * Re-adopts an edit this user already holds, for example after the composer remounted or the
   * user came back to the Session. Returns null when the Follow-up is not held by this user, in
   * which case `beginEdit` starts a new edit. Reads the latest cached snapshot (not this render's),
   * so awaiting `refresh()` first is enough when it may be stale.
   */
  function resumeEdit(followUpId: string): SessionFollowUpEdit | null {
    const options = sessionFollowUpQueueOptions(sessionId)
    const latest =
      queryClient.getQueryData<SessionFollowUpQueueSnapshot>(options.queryKey) ??
      query.data ??
      EMPTY_SNAPSHOT
    return heldEdit(latest, followUpId)
  }

  /**
   * Binds an edit from `resumeEdit` to this window before it is opened: this window then keeps the
   * hold alive and releases it when it closes or reloads. Resolves `false` when the hold is gone,
   * in which case the edit must not be opened.
   */
  async function adoptEdit(edit: Pick<SessionFollowUpEdit, 'followUpId' | 'holdId'>) {
    if (!sessionId) return false
    const adopted = await adoptHeldEdit({ sessionId, ...edit })
    if (!adopted) await refresh()
    return adopted
  }

  /**
   * Saves an open Follow-up edit in place (same identity and position) and releases its hold; the
   * queue then delivers again. GUI-only composer commands are refused like a new Follow-up. The save
   * names the revision the edit began at (`edit.queueRevision`), so reordering or other items'
   * changes do not refuse it. When `isLostFollowUpEdit(error)` holds, the edit can no longer be
   * saved: keep the draft and offer to queue it as a new message (its attachments stay bindable).
   */
  async function saveEdit(
    edit: Pick<SessionFollowUpEdit, 'followUpId' | 'holdId' | 'queueRevision'>,
    payload: SessionFollowUpEditPayload,
  ) {
    if (!sessionId) throw new Error('Select a Session before saving a queued message.')
    if (isGuiOnlyComposerCommand(payload.text)) {
      throw new Error(GUI_COMMAND_REQUIRES_IDLE_MESSAGE)
    }
    try {
      await mutate({
        operation: 'queue-edit-save',
        sessionId,
        followUpId: edit.followUpId,
        holdId: edit.holdId,
        expectedQueueRevision: edit.queueRevision,
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

  /**
   * Ends an open Follow-up edit without changing the item. Releasing a hold that is already gone
   * succeeds, and the queue then delivers if it can.
   */
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
    setPaused,
    reorder,
    beginEdit,
    resumeEdit,
    adoptEdit,
    saveEdit,
    cancelEdit,
    refresh,
  }
}
