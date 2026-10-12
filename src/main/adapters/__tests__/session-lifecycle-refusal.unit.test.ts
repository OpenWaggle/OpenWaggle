import { describe, expect, it } from 'vitest'
import { lifecyclePreparationError } from '../session-lifecycle-refusal'

/*
 * A Session lifecycle preparation refused for a reason the user can fix carries a code a client
 * acts on and the sentence that says why; anything else stays an internal failure.
 */

const WORKTREE_GONE =
  "This session's worktree no longer exists. Recreate it, or switch this session to the current checkout."
const PI_FILE_DELETED =
  "This Session's Pi session file was deleted (/p/s.jsonl). Send a message to start a new transcript before forking it."

describe('lifecyclePreparationError', () => {
  it.each([
    ['a Session whose worktree is gone', WORKTREE_GONE, 'session_worktree_missing'],
    ['a Session whose Pi file cannot be used', PI_FILE_DELETED, 'pi_session_file_unusable'],
  ])('refuses %s with its code and sentence', (_case, sentence, code) => {
    const cause = new Error('Pi could not open the session', { cause: new Error(sentence) })

    expect(lifecyclePreparationError('prepare-session-lifecycle', cause)).toMatchObject({
      operation: 'prepare-session-lifecycle',
      code,
      message: sentence,
    })
  })

  it('keeps any other failure without a code', () => {
    const failed = lifecyclePreparationError('prepare-session-lifecycle', new Error('disk full'))

    expect(failed.code).toBeUndefined()
  })
})
