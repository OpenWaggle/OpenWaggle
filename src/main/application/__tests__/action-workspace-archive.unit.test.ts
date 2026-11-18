import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import { ActionRunService } from '../../ports/action-run-service'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'
import { withSessionActionRelease } from '../action-workspace-release'

it('keeps workspace services running when the final archive fails', async () => {
  const events: string[] = []
  const result = await Effect.runPromiseExit(
    withSessionActionRelease(
      SessionId('session'),
      Effect.sync(() => {
        events.push('archive')
      }).pipe(Effect.zipRight(Effect.fail(new Error('Archive did not commit')))),
    ).pipe(
      Effect.provideService(
        SessionWorkspaceResourceRepository,
        fromPartial({
          getBound: () =>
            Effect.succeed({
              id: 'workspace',
              projectPath: '/project',
              workingPath: '/project',
              kind: 'local' as const,
              worktreeBranch: null,
            }),
          countActiveBindings: () => Effect.succeed(0),
        }),
      ),
      Effect.provideService(
        ActionRunService,
        fromPartial({
          withWorkspaceMutation: <A, E, R>(_id: string, effect: Effect.Effect<A, E, R>) => effect,
          stopWorkspaceServices: () =>
            Effect.sync(() => {
              events.push('stop')
            }),
        }),
      ),
    ),
  )
  expect(result._tag).toBe('Failure')
  expect(events).toEqual(['archive'])
})
