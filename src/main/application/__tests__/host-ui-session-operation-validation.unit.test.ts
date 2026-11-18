import { SessionId, SessionNodeId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  validateNavigateTreeOptions,
  validatePinnedSessionMove,
  validateSessionId,
  validateTreeUiStatePatch,
  validateWorkspaceSelection,
  validateWorktreePlan,
} from '../host-ui-session-operation-validation'

/**
 * The `sessions:*` request objects are decoded with their schemas
 * (`@shared/schemas/session-operation-requests`); a refusal names the field it refuses.
 */

function refusal(effect: Effect.Effect<unknown, Error>) {
  return Effect.runPromise(Effect.flip(effect)).then((error) => error.message)
}

describe('Session operation argument decoding', () => {
  it('decodes a Pinned Session move into branded ids', async () => {
    await expect(
      Effect.runPromise(
        validatePinnedSessionMove({
          sessionId: 's-1',
          afterSessionId: null,
          beforeSessionId: 's-2',
        }),
      ),
    ).resolves.toEqual({
      sessionId: SessionId('s-1'),
      afterSessionId: null,
      beforeSessionId: SessionId('s-2'),
    })
  })

  it.each([
    ['not an object', 'move', 'Pinned Session move must be an object.'],
    [
      'a blank neighbour',
      { sessionId: 's-1', afterSessionId: '  ', beforeSessionId: null },
      'afterSessionId: Session ID must be a non-empty string.',
    ],
    [
      'a numeric neighbour',
      { sessionId: 's-1', afterSessionId: null, beforeSessionId: 7 },
      'beforeSessionId: Session ID must be a non-empty string.',
    ],
    [
      'a missing neighbour',
      { sessionId: 's-1', afterSessionId: null },
      'beforeSessionId: is missing',
    ],
  ])('refuses a Pinned Session move with %s, naming the field', async (_, move, message) => {
    await expect(refusal(validatePinnedSessionMove(move))).resolves.toBe(message)
  })

  it('refuses an over-long Session ID', async () => {
    await expect(refusal(validateSessionId('x'.repeat(513)))).resolves.toBe(
      'Session ID exceeds the input limit.',
    )
  })

  it('names the expanded node a tree UI state patch refuses', async () => {
    await expect(refusal(validateTreeUiStatePatch({ expandedNodeIds: ['n-1', ''] }))).resolves.toBe(
      'expandedNodeIds.1: Session node ID must be a non-empty string.',
    )
    await expect(refusal(validateTreeUiStatePatch({ lastVisitedAt: -1 }))).resolves.toBe(
      'lastVisitedAt: Session last-visited timestamp must be a non-negative integer.',
    )
    await expect(refusal(validateTreeUiStatePatch({}))).resolves.toBe(
      'Session tree UI state patch must include at least one field.',
    )
  })

  it('decodes a tree UI state patch with only the fields it changes', async () => {
    await expect(
      Effect.runPromise(validateTreeUiStatePatch({ expandedNodeIds: ['n-1'] })),
    ).resolves.toEqual({ expandedNodeIds: [SessionNodeId('n-1')] })
  })

  it('names the field a workspace selection, navigation or worktree plan refuses', async () => {
    await expect(refusal(validateWorkspaceSelection({ nodeId: 3 }))).resolves.toBe(
      'nodeId: Session node ID must be a non-empty string.',
    )
    await expect(refusal(validateNavigateTreeOptions({ customInstructions: ' ' }))).resolves.toBe(
      'customInstructions: Session navigation custom instructions must be non-empty.',
    )
    await expect(
      refusal(
        validateWorktreePlan({ environmentMode: 'local', baseRef: 1, startFromOrigin: true }),
      ),
    ).resolves.toBe('baseRef: Session Worktree base ref must be a string or null.')
  })

  it('leaves an omitted optional argument undefined', async () => {
    await expect(Effect.runPromise(validateWorkspaceSelection(undefined))).resolves.toBeUndefined()
    await expect(Effect.runPromise(validateWorktreePlan(undefined))).resolves.toBeUndefined()
  })
})
