import type { AgentSteerDeliveryReceipt } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { create } from 'zustand'

export interface OptimisticSteerPreview {
  readonly id: string
  readonly content: string
  readonly durableContent: string
  /** null waits for the Host receipt; undefined uses the locally known prompt text. */
  readonly receipt?: Extract<AgentSteerDeliveryReceipt, { delivery: 'queued' }> | null
  readonly baselineLength: number
  readonly baselineUserMessageIds: ReadonlySet<string>
  readonly message: UIMessage
  readonly durableMessageId?: string
  readonly durableMessageCreatedOrder?: number
}

interface OptimisticSteerState {
  readonly previews: Map<SessionId, readonly OptimisticSteerPreview[]>
  readonly pendingPromotions: Map<SessionId, readonly string[]>
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
  readonly reconcile: (
    sessionId: SessionId,
    observedPreviews: readonly OptimisticSteerPreview[],
    allObservedAreDurable: boolean,
  ) => void
}

const EMPTY_PREVIEWS: readonly OptimisticSteerPreview[] = []
const EMPTY_PROMOTIONS: readonly string[] = []

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

export const useOptimisticSteerStore = create<OptimisticSteerState>((set) => ({
  previews: new Map(),
  pendingPromotions: new Map(),
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
      const next = new Map(state.previews)
      next.set(sessionId, [...(next.get(sessionId) ?? []), preview])
      return { previews: next }
    })
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
