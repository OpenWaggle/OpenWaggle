import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { create } from 'zustand'

export interface OptimisticSteerPreview {
  readonly id: string
  readonly content: string
  readonly baselineLength: number
  readonly message: UIMessage
  readonly durableMessageId?: string
}

interface OptimisticSteerState {
  readonly previews: Map<SessionId, readonly OptimisticSteerPreview[]>
  readonly add: (sessionId: SessionId, preview: OptimisticSteerPreview) => void
  readonly update: (
    sessionId: SessionId,
    previewId: string,
    update: (preview: OptimisticSteerPreview) => OptimisticSteerPreview,
  ) => void
  readonly remove: (sessionId: SessionId, previewId: string) => void
  readonly reconcile: (
    sessionId: SessionId,
    observedPreviews: readonly OptimisticSteerPreview[],
    allObservedAreDurable: boolean,
  ) => void
}

const EMPTY_PREVIEWS: readonly OptimisticSteerPreview[] = []
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
          ? [{ ...preview, durableMessageId: observed.durableMessageId }]
          : [preview]
      })
      const next = new Map(state.previews)
      if (reconciled.length === 0) next.delete(sessionId)
      else next.set(sessionId, reconciled)
      return { previews: next }
    })
  },
}))
