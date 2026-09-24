import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import { ActionRunService } from '../../ports/action-run-service'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'
import { withSessionActionRelease } from '../action-workspace-release'

it('returns a committed archive and retries service shutdown after a transient failure', async () => {
  const events: string[] = []
  let stops = 0
  const result = await Effect.runPromise(
    withSessionActionRelease(
      SessionId('session'),
      Effect.sync(() => {
        events.push('archive')
        return 'archived'
      }),
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
              pending: false,
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
            Effect.try(() => {
              stops += 1
              if (stops === 1) throw new Error('Process exit could not be confirmed')
              events.push('stopped')
            }).pipe(Effect.mapError((error) => new Error(String(error)))),
        }),
      ),
    ),
  )
  expect(result).toBe('archived')
  expect(events).toEqual(['archive'])
  await expect.poll(() => stops, { timeout: 3_000 }).toBe(2)
  expect(events).toEqual(['archive', 'stopped'])
})

it('leaves services running if the workspace is rebound before a shutdown retry', async () => {
  let activeBindings = 0
  let bindingChecks = 0
  let stops = 0
  await Effect.runPromise(
    withSessionActionRelease(SessionId('session'), Effect.succeed('archived')).pipe(
      Effect.provideService(
        SessionWorkspaceResourceRepository,
        fromPartial({
          getBound: () =>
            Effect.succeed({
              id: 'workspace',
              projectPath: '/project',
              workingPath: '/project',
              kind: 'local' as const,
              pending: false,
              worktreeBranch: null,
            }),
          countActiveBindings: () =>
            Effect.sync(() => {
              bindingChecks += 1
              return activeBindings
            }),
        }),
      ),
      Effect.provideService(
        ActionRunService,
        fromPartial({
          withWorkspaceMutation: <A, E, R>(_id: string, effect: Effect.Effect<A, E, R>) => effect,
          stopWorkspaceServices: () =>
            Effect.try(() => {
              stops += 1
              throw new Error('Process exit could not be confirmed')
            }).pipe(Effect.mapError((error) => new Error(String(error)))),
        }),
      ),
    ),
  )
  expect(stops).toBe(1)
  activeBindings = 1
  await expect.poll(() => bindingChecks, { timeout: 3_000 }).toBe(2)
  expect(stops).toBe(1)
})
