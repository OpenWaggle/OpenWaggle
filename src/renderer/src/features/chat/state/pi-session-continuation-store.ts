import type { PiSessionContinuationChoice } from '@shared/pi-session-continuation'
import type { SessionId } from '@shared/types/brand'
import { create } from 'zustand'

export interface PiSessionContinuationAnswer {
  readonly choice: PiSessionContinuationChoice
  /** Remember the choice for the Session's project, for this person only. */
  readonly remember: boolean
}

interface PendingPiSessionContinuation {
  readonly sessionId: SessionId
  readonly projectPath: string | null
  readonly resolve: (answer: PiSessionContinuationAnswer | null) => void
}

interface PiSessionContinuationState {
  readonly pending: PendingPiSessionContinuation | null
  /** Asks the person; resolves null when they dismiss the prompt. One prompt at a time. */
  readonly ask: (input: {
    readonly sessionId: SessionId
    readonly projectPath: string | null
  }) => Promise<PiSessionContinuationAnswer | null>
  readonly answer: (answer: PiSessionContinuationAnswer | null) => void
}

/** The open Pi continuation prompt (ADR 0051), shown above the composer that asked. */
export const usePiSessionContinuationStore = create<PiSessionContinuationState>((set, get) => ({
  pending: null,
  ask: (input) =>
    new Promise((resolve) => {
      // A prompt still open for another send is dismissed, so its send restores its draft.
      get().pending?.resolve(null)
      set({ pending: { ...input, resolve } })
    }),
  answer: (answer) => {
    const pending = get().pending
    if (!pending) return
    set({ pending: null })
    pending.resolve(answer)
  },
}))
