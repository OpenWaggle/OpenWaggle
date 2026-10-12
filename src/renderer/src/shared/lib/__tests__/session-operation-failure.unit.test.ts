import { describe, expect, it } from 'vitest'
import { sessionOperationFailureMessage } from '../session-operation-failure'

const REMOTE = "Error invoking remote method 'sessions:fork-to-new': Error: "
const WORKTREE_GONE =
  "This session's worktree no longer exists. Recreate it, or switch this session to the current checkout."

describe('sessionOperationFailureMessage', () => {
  it('says why a Session cannot be copied without the preparation error class', () => {
    const error = new Error(
      `${REMOTE}SessionLifecyclePreparationError (prepare-session-lifecycle): ${WORKTREE_GONE}`,
    )

    expect(sessionOperationFailureMessage('Failed to fork session', error)).toBe(
      `Failed to fork session: ${WORKTREE_GONE}`,
    )
  })

  it('shows the sentence of a Session whose Pi file cannot be used as it is', () => {
    const sentence =
      "This Session's Pi session file was deleted (/p/s.jsonl). Send a message to start a new transcript before forking it."

    expect(
      sessionOperationFailureMessage('Failed to fork session', new Error(`${REMOTE}${sentence}`)),
    ).toBe(sentence)
  })

  it('keeps any other reason as it is', () => {
    expect(
      sessionOperationFailureMessage(
        'Failed to fork session',
        new Error(`${REMOTE}Session is busy`),
      ),
    ).toBe('Failed to fork session: Session is busy')
  })
})
