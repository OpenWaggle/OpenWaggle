import type { PiSessionContinuationChoice } from '@shared/pi-session-continuation'
import type { SessionDetail } from '@shared/types/session'

/**
 * A send the Pi continuation choice held back (ADR 0051): kept in pi, or the prompt was dismissed.
 * Its message goes back to the composer; nothing reached the agent.
 */
export type PiSessionContinuationHeldOutcome =
  /** The Session's terminal opened with the `pi` command typed in. */
  | 'kept-in-pi'
  /** No terminal could open, so the `pi` command was copied instead. */
  | 'kept-in-pi-copied'
  | 'dismissed'

export class PiSessionContinuationHeld extends Error {
  readonly outcome: PiSessionContinuationHeldOutcome

  constructor(outcome: PiSessionContinuationHeldOutcome) {
    super(
      outcome === 'dismissed'
        ? 'The Pi continuation choice was dismissed; the message was not sent.'
        : 'Kept running in pi; the message was not sent from OpenWaggle.',
    )
    this.name = 'PiSessionContinuationHeld'
    this.outcome = outcome
  }
}

/** The toast after a held send; the message is back in the composer either way. */
export function piSessionContinuationHeldNotice(held: PiSessionContinuationHeld) {
  if (held.outcome === 'kept-in-pi') {
    return 'Kept in pi: press Enter in the terminal to continue there. Your message is back in the composer.'
  }
  if (held.outcome === 'kept-in-pi-copied') {
    return 'No terminal could open, so the pi command is copied. Your message is back in the composer.'
  }
  return 'Not sent. Your message is back in the composer.'
}

/**
 * Whether a send may need the choice: the Session has a Pi file that something outside OpenWaggle
 * may write to. A discovered Session is read again first, as the `pi` CLI may have used it since
 * it was shown; one OpenWaggle created asks only once its read said so.
 */
export function mayNeedPiSessionContinuationChoice(session: SessionDetail) {
  if (!session.piSessionFile || session.piSessionFileDeleted) return false
  return session.piSessionLastPromptOutside === true || session.piEntryNodeIdPrefix !== undefined
}

/** The project's remembered choice for this person; undefined asks. */
export function rememberedPiSessionContinuation(
  byProject: Readonly<Record<string, PiSessionContinuationChoice>>,
  projectPath: string | null,
) {
  return projectPath ? byProject[projectPath] : undefined
}
