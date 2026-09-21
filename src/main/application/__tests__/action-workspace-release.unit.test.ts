import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { ActionRunService } from '../../ports/action-run-service'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'
import { withSessionActionRelease } from '../action-workspace-release'

describe('action lifetime follows active Workspace bindings', () => {
  it.each([0, 1])(
    'stops services before final release only (%s other bindings)',
    async (remaining) => {
      const events: string[] = []
      const operation = withSessionActionRelease(
        SessionId('session'),
        Effect.sync(() => {
          events.push('archive')
        }),
      )
      await Effect.runPromise(
        operation.pipe(
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
              countActiveBindings: () => Effect.succeed(remaining),
            }),
          ),
          Effect.provideService(
            ActionRunService,
            fromPartial({
              withWorkspaceMutation: <A, E, R>(_id: string, effect: Effect.Effect<A, E, R>) =>
                Effect.sync(() => {
                  events.push('lock')
                }).pipe(Effect.zipRight(effect)),
              stopWorkspaceServices: () =>
                Effect.sync(() => {
                  events.push('stop')
                }),
            }),
          ),
        ),
      )
      expect(events).toEqual(remaining === 0 ? ['lock', 'stop', 'archive'] : ['lock', 'archive'])
    },
  )
  it.each([true, false])(
    'releases services only after a successful handoff (%s)',
    async (succeeds) => {
      const events: string[] = []
      const operation = withSessionActionRelease(
        SessionId('session'),
        Effect.sync(() => {
          events.push('handoff')
          if (!succeeds) throw new Error('handoff failed')
        }),
        'after',
      )
      await Effect.runPromise(
        operation.pipe(
          Effect.provideService(
            SessionWorkspaceResourceRepository,
            fromPartial({
              getBound: () =>
                Effect.succeed({
                  id: 'old',
                  projectPath: '/repo',
                  workingPath: '/repo',
                  kind: 'local' as const,
                  worktreeBranch: null,
                }),
              countActiveBindings: () => Effect.succeed(0),
            }),
          ),
          Effect.provideService(
            ActionRunService,
            fromPartial({
              withWorkspaceMutation: <A, E, R>(_id: string, effect: Effect.Effect<A, E, R>) =>
                effect,
              stopWorkspaceServices: () =>
                Effect.sync(() => {
                  events.push('stop')
                }),
            }),
          ),
          Effect.exit,
        ),
      )
      expect(events).toEqual(succeeds ? ['handoff', 'stop'] : ['handoff'])
    },
  )
})
