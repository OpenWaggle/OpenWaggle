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

  it('says a Session held by its Run is busy, without the internal writer name', () => {
    const error = new Error(
      `${REMOTE}Session cefe5371-3676-4ded-922c-f231125b7d7f already has an active classic Pi writer.`,
    )

    expect(sessionOperationFailureMessage('Failed to fork session', error)).toBe(
      'Failed to fork session: this Session is busy. Wait for its Run to finish, then try again.',
    )
  })

  it('keeps any other reason as it is', () => {
    expect(
      sessionOperationFailureMessage(
        'Failed to fork session',
        new Error(`${REMOTE}Session is busy`),
      ),
    ).toBe('Failed to fork session: Session is busy')
  })

  it("names the provider's reason once, in its words, for a summary it refused", () => {
    const providerError =
      '401: {"error":{"message":"Incorrect API key provided: qa-***fake","type":"invalid_request_error","code":"invalid_api_key"}}'
    const error = new Error(
      `Error invoking remote method 'sessions:navigate-tree': Error: Branch summarization failed: ${providerError}`,
    )

    expect(sessionOperationFailureMessage('Failed to summarize the branch', error)).toBe(
      'Failed to summarize the branch: Incorrect API key provided: qa-***fake',
    )
  })

  it('keeps a reason that is not JSON as it is, without a second failure clause', () => {
    const error = new Error(
      "Error invoking remote method 'sessions:navigate-tree': Error: Branch summarization failed: the model is overloaded",
    )

    expect(sessionOperationFailureMessage('Failed to summarize the branch', error)).toBe(
      'Failed to summarize the branch: the model is overloaded',
    )
  })
})
