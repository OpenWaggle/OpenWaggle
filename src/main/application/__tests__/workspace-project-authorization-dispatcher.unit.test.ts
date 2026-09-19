import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceProjectAuthorization } from '../../ports/workspace-project-authorization'
import { dispatchHostUiRequest } from '../host-ui-request-dispatcher'

function runRequest(
  callerId: string,
  args: readonly unknown[],
  authorize = vi.fn(() => Effect.succeed('/project')),
) {
  const request = dispatchHostUiRequest({
    caller: { callerId },
    request: {
      contractVersion: 1,
      requestId: 'authorize-workspace',
      channel: 'workspace-files:authorize-project',
      args: args.map((value) => ({ kind: 'value', value })),
    },
  }).pipe(Effect.provideService(WorkspaceProjectAuthorization, { authorize }))
  return Effect.runPromise(fromAny<Effect.Effect<unknown, unknown, never>, typeof request>(request))
}

describe('Host workspace authorization dispatcher', () => {
  it('returns a correlated owner authorization result to the local GUI only', async () => {
    const authorize = vi.fn(() => Effect.succeed('/project'))
    await expect(runRequest('gui:local-user', ['/project'], authorize)).resolves.toEqual({
      contract: 'host-ui-v1',
      response: {
        contractVersion: 1,
        requestId: 'authorize-workspace',
        channel: 'workspace-files:authorize-project',
        result: { kind: 'value', value: '/project' },
      },
    })
    expect(authorize).toHaveBeenCalledWith('/project')
  })

  it.each(['cli:external', 'local-user:machine'])(
    'rejects non-GUI caller %s before authorization',
    async (callerId) => {
      const authorize = vi.fn(() => Effect.succeed('/project'))
      await expect(runRequest(callerId, ['/project'], authorize)).rejects.toThrow(
        /local OpenWaggle GUI/,
      )
      expect(authorize).not.toHaveBeenCalled()
    },
  )

  it.each([[], ['/project', '/other'], [null], [{}], ['']])(
    'rejects malformed arguments %j before authorization',
    async (...args) => {
      const authorize = vi.fn(() => Effect.succeed('/project'))
      await expect(runRequest('gui:local-user', args, authorize)).rejects.toThrow()
      expect(authorize).not.toHaveBeenCalled()
    },
  )
})
