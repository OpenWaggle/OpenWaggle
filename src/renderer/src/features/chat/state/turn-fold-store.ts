import { create } from 'zustand'

interface TurnFoldState {
  /** In-memory (ADR 0033): fold expansion resets when the app restarts. */
  readonly expandedTurnKeysBySessionId: Map<string, ReadonlySet<string>>
  readonly toggleTurnFold: (sessionId: string | null, turnKey: string) => void
}

function foldScopeKey(sessionId: string | null) {
  return sessionId ?? 'sessionless'
}

export const useTurnFoldStore = create<TurnFoldState>((set) => ({
  expandedTurnKeysBySessionId: new Map(),

  toggleTurnFold(sessionId, turnKey) {
    set((state) => {
      const scope = foldScopeKey(sessionId)
      const existing = state.expandedTurnKeysBySessionId.get(scope) ?? new Set<string>()
      const next = new Set(existing)
      if (next.has(turnKey)) {
        next.delete(turnKey)
      } else {
        next.add(turnKey)
      }
      const nextByScope = new Map(state.expandedTurnKeysBySessionId)
      nextByScope.set(scope, next)
      return { expandedTurnKeysBySessionId: nextByScope }
    })
  },
}))

const emptyTurnKeys: ReadonlySet<string> = new Set()
const selectorCache = new Map<string, (state: TurnFoldState) => ReadonlySet<string>>()

/** Stable per-session selector so Map identity churn does not re-render unrelated sessions. */
export function selectExpandedTurnKeys(sessionId: string | null) {
  const scope = foldScopeKey(sessionId)
  let selector = selectorCache.get(scope)
  if (!selector) {
    selector = (state: TurnFoldState) =>
      state.expandedTurnKeysBySessionId.get(scope) ?? emptyTurnKeys
    selectorCache.set(scope, selector)
  }
  return selector
}
