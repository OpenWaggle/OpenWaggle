import { SessionId } from '@shared/types/brand'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dispatchLocalSessionCommandMock } = vi.hoisted(() => ({
  dispatchLocalSessionCommandMock: vi.fn(),
}))

vi.mock('../local-session-command-dispatcher', () => ({
  dispatchLocalSessionCommand: dispatchLocalSessionCommandMock,
}))
vi.mock('../../agent/session-cleanup', () => ({ cleanupSessionRun: vi.fn() }))
vi.mock('../../utils/stream-bridge', () => ({
  clearAgentPhase: vi.fn(),
  clearStreamBuffer: vi.fn(),
  emitRunCompleted: vi.fn(),
}))

import { dispatchHostBackedSessionGuiOperation } from '../host-ui-session-operation-dispatcher'
import { isPiSessionDiscoveryPaused } from '../pi-session-discovery-pauses'

/**
 * `sessions:delete` and `sessions:begin-project-removal` as the desktop app calls them: removing
 * a project deletes its Sessions without dismissing a discovered Pi file (ADR 0051).
 */

const SESSION_ID = SessionId('session-1')

function dispatch(channel: 'sessions:delete' | 'sessions:begin-project-removal', args: unknown[]) {
  const effect = dispatchHostBackedSessionGuiOperation(channel, args)
  return Effect.runPromise(fromAny<Effect.Effect<unknown, unknown>, typeof effect>(effect))
}

function deletedCommand() {
  const [call] = dispatchLocalSessionCommandMock.mock.calls
  return call?.[0]?.payload?.request?.command
}

describe('Host UI Session deletion', () => {
  beforeEach(() => {
    dispatchLocalSessionCommandMock.mockReset().mockReturnValue(
      Effect.succeed({
        contract: 'local-ui-v1',
        response: { requestId: 'request-ui', effect: 'session-deleted', sessionId: 'session-1' },
      }),
    )
  })

  it.each([
    ['an array', [true], 'Session delete options are invalid.'],
    ['null', null, 'Session delete options are invalid.'],
    ['a non-boolean flag', { removingProject: 'yes' }, 'must be a boolean'],
  ])('refuses delete options that are %s', async (_, options, message) => {
    await expect(dispatch('sessions:delete', [SESSION_ID, options])).rejects.toThrow(message)
    expect(dispatchLocalSessionCommandMock).not.toHaveBeenCalled()
  })

  it.each([
    ['on its own without the project removal flag', [SESSION_ID], {}],
    [
      'with a project removal passed to the deletion itself',
      [SESSION_ID, { removingProject: true }],
      { removingProject: true },
    ],
  ])('deletes a Session %s', async (_, args, removal) => {
    await dispatch('sessions:delete', args)

    expect(deletedCommand()).toEqual({ operation: 'delete', sessionId: SESSION_ID, ...removal })
  })

  it.each([
    ['no project', [], 'Expected 1 Session operation arguments.'],
    ['a number', [42], 'Project path must be a non-empty string.'],
    ['a blank path', ['  '], 'Project path must be a non-empty string.'],
    ['two arguments', ['/project', '/other'], 'Expected 1 Session operation arguments.'],
  ])('refuses to begin a project removal for %s', async (_, args, message) => {
    await expect(dispatch('sessions:begin-project-removal', args)).rejects.toThrow(message)
  })

  it("pauses discovery for the project it begins to remove, by the project's path", async () => {
    await expect(
      dispatch('sessions:begin-project-removal', [' /projects/removed ']),
    ).resolves.toBeUndefined()

    expect(isPiSessionDiscoveryPaused('/projects/removed')).toBe(true)
  })
})
