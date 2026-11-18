import type { AgentSteerDeliveryReceipt } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { create } from 'zustand'
import { isUnnamedRunStart, settlingRunId } from '@/features/chat/lib/run-ids'
import { withIncorporatedPreview } from '@/features/chat/lib/steer-preview-incorporation'

/** What the user row a steer becomes shows: its typed text and how many attachments it carries. */
export interface SteerIncorporatedContent {
  readonly text: string
  readonly attachmentCount: number
}

export interface OptimisticSteerPreview {
  readonly id: string
  readonly content: string
  /** Display-only pairing while a promotion awaits its receipt; the receipt alone records it. */
  readonly incorporatedContent: SteerIncorporatedContent
  readonly durableContent: string
  /** null waits for the Host receipt; undefined uses the locally known prompt text. */
  readonly receipt?: Extract<AgentSteerDeliveryReceipt, { delivery: 'queued' }> | null
  readonly baselineUserMessageIds: ReadonlySet<string>
  /** The highest native log order the transcript held when the preview began, or -1. */
  readonly baselineMaxCreatedOrder: number
  readonly message: UIMessage
  readonly durableMessageId?: string
  readonly durableMessageCreatedOrder?: number
  /**
   * When Pi incorporated the steer (the Host time of the user row it became, once seen): should
   * that row leave the transcript (rebuilt from a detail that lacks it), the preview stands in
   * for it there, not below the answers after it.
   */
  readonly incorporatedAt?: number
  /** The user row `incorporatedAt` came from, and its log order: the preview is that row only. */
  readonly incorporatedRowId?: string
  readonly incorporatedOrder?: number
  /** The Run the steer was promoted into, as this renderer last saw one start. */
  readonly runId?: string
}

interface OptimisticSteerState {
  readonly previews: Map<SessionId, readonly OptimisticSteerPreview[]>
  /** The Run each Session last started, as this renderer saw it: previews are promoted into it. */
  readonly runIds: Map<SessionId, string>
  readonly pendingPromotions: Map<SessionId, readonly string[]>
  /** How many times the user has stopped each Session's Run from this window. */
  readonly userStops: Map<SessionId, number>
  readonly noteUserStop: (sessionId: SessionId) => void
  readonly beginPromotion: (sessionId: SessionId, followUpId: string) => boolean
  readonly finishPromotion: (sessionId: SessionId, followUpId: string) => void
  readonly add: (sessionId: SessionId, preview: OptimisticSteerPreview) => void
  readonly update: (
    sessionId: SessionId,
    previewId: string,
    update: (preview: OptimisticSteerPreview) => OptimisticSteerPreview,
  ) => void
  readonly remove: (sessionId: SessionId, previewId: string) => void
  readonly clearSession: (sessionId: SessionId) => void
  /**
   * A named Run started (an `agent_start`, relayed live or by a resync): a preview promoted into
   * another Run is gone, as that Run ended and the Host returned its untaken steers to the queue
   * when it settled, though a stall may have hidden that settlement.
   */
  readonly noteRunStarted: (sessionId: SessionId, runId: string) => void
  /** Pi incorporated a user message: the waiting preview it is records when (`incorporatedAt`). */
  readonly noteIncorporated: (sessionId: SessionId, userRow: UIMessage) => void
  readonly reconcile: (
    sessionId: SessionId,
    observedPreviews: readonly OptimisticSteerPreview[],
    allObservedAreDurable: boolean,
  ) => void
}

const EMPTY_PREVIEWS: readonly OptimisticSteerPreview[] = []
const EMPTY_PROMOTIONS: readonly string[] = []

/** The user's Stop count for a Session, to tell a Stop apart from a failed promotion. */
export function userStopCount(sessionId: SessionId) {
  return useOptimisticSteerStore.getState().userStops.get(sessionId) ?? 0
}

export function selectPendingSteerFollowUps(sessionId: SessionId | null) {
  return (state: OptimisticSteerState) =>
    (sessionId ? state.pendingPromotions.get(sessionId) : undefined) ?? EMPTY_PROMOTIONS
}
const nullSelector = (_state: OptimisticSteerState) => EMPTY_PREVIEWS
const selectorCache = new Map<
  SessionId,
  (state: OptimisticSteerState) => readonly OptimisticSteerPreview[]
>()

export function selectOptimisticSteerPreviews(sessionId: SessionId | null) {
  if (!sessionId) return nullSelector
  let selector = selectorCache.get(sessionId)
  if (!selector) {
    selector = (state: OptimisticSteerState) => state.previews.get(sessionId) ?? EMPTY_PREVIEWS
    selectorCache.set(sessionId, selector)
  }
  return selector
}

/** The state once `runId` started in the Session: previews promoted into another Run go. */
function withRunStarted(state: OptimisticSteerState, sessionId: SessionId, runId: string) {
  const runIds = new Map(state.runIds).set(sessionId, runId)
  const current = state.previews.get(sessionId)
  // A Waggle the Run requested goes on as that Run; a retry or continuation keeps its id.
  const kept = current?.filter(
    (preview) =>
      preview.runId === undefined || settlingRunId(preview.runId) === settlingRunId(runId),
  )
  if (!current || !kept || kept.length === current.length) return { runIds }
  const previews = new Map(state.previews)
  if (kept.length > 0) previews.set(sessionId, kept)
  else previews.delete(sessionId)
  return { runIds, previews }
}

export const useOptimisticSteerStore = create<OptimisticSteerState>((set) => ({
  previews: new Map(),
  runIds: new Map(),
  pendingPromotions: new Map(),
  userStops: new Map(),
  noteUserStop(sessionId) {
    set((state) => {
      const userStops = new Map(state.userStops)
      userStops.set(sessionId, (state.userStops.get(sessionId) ?? 0) + 1)
      return { userStops }
    })
  },
  beginPromotion(sessionId, followUpId) {
    let started = false
    set((state) => {
      const current = state.pendingPromotions.get(sessionId) ?? EMPTY_PROMOTIONS
      if (current.includes(followUpId)) return state
      started = true
      const pendingPromotions = new Map(state.pendingPromotions)
      pendingPromotions.set(sessionId, [...current, followUpId])
      return { pendingPromotions }
    })
    return started
  },
  finishPromotion(sessionId, followUpId) {
    set((state) => {
      const current = state.pendingPromotions.get(sessionId)
      if (!current?.includes(followUpId)) return state
      const pendingPromotions = new Map(state.pendingPromotions)
      const remaining = current.filter((id) => id !== followUpId)
      if (remaining.length > 0) pendingPromotions.set(sessionId, remaining)
      else pendingPromotions.delete(sessionId)
      return { pendingPromotions }
    })
  },
  add(sessionId, preview) {
    set((state) => {
      const runId = preview.runId ?? state.runIds.get(sessionId)
      const next = new Map(state.previews)
      next.set(sessionId, [...(next.get(sessionId) ?? []), runId ? { ...preview, runId } : preview])
      return { previews: next }
    })
  },
  noteRunStarted(sessionId, runId) {
    if (!isUnnamedRunStart(runId)) set((state) => withRunStarted(state, sessionId, runId))
  },
  update(sessionId, previewId, update) {
    set((state) => {
      const current = state.previews.get(sessionId)
      if (!current) return state
      const nextPreviews = current.map((preview) =>
        preview.id === previewId ? update(preview) : preview,
      )
      if (nextPreviews.every((preview, index) => preview === current[index])) return state
      const next = new Map(state.previews)
      next.set(sessionId, nextPreviews)
      return { previews: next }
    })
  },
  remove(sessionId, previewId) {
    set((state) => {
      const current = state.previews.get(sessionId)
      if (!current) return state
      const remaining = current.filter((preview) => preview.id !== previewId)
      if (remaining.length === current.length) return state
      const next = new Map(state.previews)
      if (remaining.length === 0) next.delete(sessionId)
      else next.set(sessionId, remaining)
      return { previews: next }
    })
  },
  clearSession(sessionId) {
    set((state) => {
      if (!state.previews.has(sessionId)) return state
      const next = new Map(state.previews)
      next.delete(sessionId)
      return { previews: next }
    })
  },
  noteIncorporated(sessionId, userRow) {
    set((state) => {
      const current = state.previews.get(sessionId)
      const noted = current ? withIncorporatedPreview(current, userRow) : current
      if (!current || noted === current) return state
      return { previews: new Map(state.previews).set(sessionId, noted ?? current) }
    })
  },
  reconcile(sessionId, observedPreviews, allObservedAreDurable) {
    set((state) => {
      const current = state.previews.get(sessionId)
      if (!current) return state
      const observedById = new Map(observedPreviews.map((preview) => [preview.id, preview]))
      const reconciled = current.flatMap((preview) => {
        const observed = observedById.get(preview.id)
        if (!observed) return [preview]
        if (allObservedAreDurable) return []
        return observed.durableMessageId
          ? [
              {
                ...preview,
                durableMessageId: observed.durableMessageId,
                ...(observed.durableMessageCreatedOrder !== undefined
                  ? { durableMessageCreatedOrder: observed.durableMessageCreatedOrder }
                  : {}),
              },
            ]
          : [preview]
      })
      const next = new Map(state.previews)
      if (reconciled.length === 0) next.delete(sessionId)
      else next.set(sessionId, reconciled)
      return { previews: next }
    })
  },
}))
