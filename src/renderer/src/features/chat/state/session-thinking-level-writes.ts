import type { SessionId } from '@shared/types/brand'
import type { SessionThinkingLevelChange } from '@shared/types/session'
import type { ThinkingLevel } from '@shared/types/settings'
import { create } from 'zustand'

/** A pick for the draft composer, before its Session exists: Pi's global default. */
export const DEFAULT_THINKING_LEVEL_TARGET = 'default'

export type ThinkingLevelTarget = SessionId | typeof DEFAULT_THINKING_LEVEL_TARGET

/**
 * Thinking-level picks whose Host write has not settled yet, laid over what the Host last reported
 * so the pick shows at once and a stale read cannot put the previous level back on screen.
 */
interface PendingThinkingLevelState {
  readonly pending: ReadonlyMap<ThinkingLevelTarget, ThinkingLevel>
  readonly setPending: (target: ThinkingLevelTarget, level: ThinkingLevel) => void
  readonly clearPending: (target: ThinkingLevelTarget, level: ThinkingLevel) => void
}

export const usePendingThinkingLevelStore = create<PendingThinkingLevelState>((set) => ({
  pending: new Map(),
  setPending: (target, level) =>
    set((state) => ({ pending: new Map(state.pending).set(target, level) })),
  clearPending: (target, level) =>
    set((state) => {
      // Only the newest pick clears itself, so an earlier write settling late keeps a newer pick.
      if (state.pending.get(target) !== level) return state
      const pending = new Map(state.pending)
      pending.delete(target)
      return { pending }
    }),
}))

/** Thrown when the Host refuses a Session thinking-level change, with its code. */
export class SessionThinkingLevelRefusedError extends Error {
  readonly code: Extract<SessionThinkingLevelChange, { changed: false }>['code']

  constructor(code: Extract<SessionThinkingLevelChange, { changed: false }>['code']) {
    super(
      code === 'session_run_active'
        ? 'The thinking level can change only while no Run is active.'
        : 'This Session has no settings to change.',
    )
    this.name = 'SessionThinkingLevelRefusedError'
    this.code = code
  }
}

const chains = new Map<ThinkingLevelTarget, Promise<void>>()

interface ThinkingLevelWriteInput {
  readonly target: ThinkingLevelTarget
  readonly level: ThinkingLevel
  /** Stores the pick through the Session Host. */
  readonly write: () => Promise<void>
  /** Re-reads what the Host stored, so the view converges on it before the pick is dropped. */
  readonly refresh: () => Promise<void>
}

/** Serializes writes per target so they land in pick order; rejects with the write's failure. */
export function writeThinkingLevel(input: ThinkingLevelWriteInput): Promise<void> {
  const store = usePendingThinkingLevelStore.getState()
  store.setPending(input.target, input.level)
  const previous = chains.get(input.target) ?? Promise.resolve()
  const result = previous.then(input.write).finally(async () => {
    await input.refresh().catch(() => undefined)
    usePendingThinkingLevelStore.getState().clearPending(input.target, input.level)
  })
  const chain = result.then(
    () => undefined,
    () => undefined,
  )
  chains.set(input.target, chain)
  void chain.finally(() => {
    if (chains.get(input.target) === chain) chains.delete(input.target)
  })
  return result
}

export function resetThinkingLevelWritesForTests() {
  chains.clear()
  usePendingThinkingLevelStore.setState({ pending: new Map() })
}
