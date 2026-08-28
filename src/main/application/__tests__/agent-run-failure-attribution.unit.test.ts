import { SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { recoverAgentRunFailure } from '../agent-run/outcome'

/**
 * Whether a failed run had already given the agent the message decides what a caller does with work it
 * submitted alongside it: a refusal means the work must come back, while a failure after the answer means the
 * agent has it and offering it again would send it twice.
 */
describe('attributing an agent run failure', () => {
  const signal = new AbortController().signal

  it('marks a failure after the agent answered as one the message reached', async () => {
    /*
     * Persisting the turn happens after the kernel returns, so a database write failure there is a typed failure
     * recovered into an ordinary error outcome - indistinguishable, to the caller, from a refusal raised before
     * the prompt was ever sent. A caller holding a submitted review then restored work the agent already had and
     * offered it for a second submission.
     */
    const outcome = await Effect.runPromise(
      recoverAgentRunFailure({
        error: new Error('database is locked'),
        signal,
        sessionId: SessionId('session-1'),
        runId: 'run-1',
        model: SupportedModelId('claude-sonnet-4-5'),
        reachedAgent: true,
      }),
    )

    expect(outcome).toMatchObject({ outcome: 'error', transportEmitted: true })
  })

  it('does not mark a failure raised before the agent saw the message', async () => {
    const outcome = await Effect.runPromise(
      recoverAgentRunFailure({
        error: new Error('this session has no worktree'),
        signal,
        sessionId: SessionId('session-1'),
        runId: 'run-1',
        model: SupportedModelId('claude-sonnet-4-5'),
      }),
    )

    expect(outcome).toMatchObject({ outcome: 'error' })
    expect(outcome).not.toHaveProperty('transportEmitted')
  })

  it('does not mark a run that was cancelled before its prompt', async () => {
    /*
     * A run whose signal was already aborted returns from the kernel without prompting at all, so "the kernel
     * returned" was never the same as "the agent has the message". Marking it anyway meant that if persisting
     * such a run then failed, the caller was told the message was delivered and discarded the review.
     */
    const outcome = await Effect.runPromise(
      recoverAgentRunFailure({
        error: new Error('database is locked'),
        signal,
        sessionId: SessionId('session-1'),
        runId: 'run-1',
        model: SupportedModelId('claude-sonnet-4-5'),
        reachedAgent: false,
      }),
    )

    expect(outcome).not.toHaveProperty('transportEmitted')
  })
})
