import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { ActionRunService } from '../../ports/action-run-service'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'
import { withSessionActionRelease } from '../action-workspace-release'

describe('action lifetime follows active Workspace bindings', () => {
  const localWorkspace = (id = 'workspace') => ({
    id,
    projectPath: '/project',
    workingPath: '/project',
    kind: 'local' as const,
    pending: false,
    worktreeBranch: null,
  })

  it.each([
    { durable: 0, active: 0, expected: ['stop-all', 'delete', 'cleanup'] },
    { durable: 1, active: 1, expected: ['delete', 'cleanup'] },
    { durable: 1, active: 0, expected: ['stop-services', 'delete', 'cleanup'] },
  ])(
    'retires local action runs only after the last durable binding ($durable/$active)',
    async ({ durable, active, expected }) => {
      const events: string[] = []
      await Effect.runPromise(
        withSessionActionRelease(
          SessionId('session'),
          Effect.sync(() => events.push('delete')),
          'before',
          'delete',
        ).pipe(
          Effect.provideService(
            SessionWorkspaceResourceRepository,
            fromPartial({
              getBound: () => Effect.succeed(localWorkspace()),
              countBindings: () => Effect.succeed(durable),
              countActiveBindings: () => Effect.succeed(active),
            }),
          ),
          Effect.provideService(
            ActionRunService,
            fromPartial({
              withWorkspaceMutation: <A, E, R>(_id: string, effect: Effect.Effect<A, E, R>) =>
                effect,
              stopWorkspaceRuns: () =>
                Effect.sync(() => {
                  events.push('stop-all')
                }),
              stopWorkspaceServices: () =>
                Effect.sync(() => {
                  events.push('stop-services')
                }),
              cleanupDeletedWorkspaces: Effect.sync(() => {
                events.push('cleanup')
              }),
            }),
          ),
        ),
      )
      expect(events).toEqual(expected)
    },
  )

  it('waits for every local action process before deletion and drains logs after later failure', async () => {
    const started = Promise.withResolvers<void>()
    const stopped = Promise.withResolvers<void>()
    const events: string[] = []
    const deletion = Effect.runPromiseExit(
      withSessionActionRelease(
        SessionId('session'),
        Effect.sync(() => {
          events.push('commit')
        }).pipe(Effect.zipRight(Effect.fail(new Error('Pi cleanup failed')))),
        'before',
        'delete',
      ).pipe(
        Effect.provideService(
          SessionWorkspaceResourceRepository,
          fromPartial({
            getBound: () => Effect.succeed(localWorkspace()),
            countBindings: () => Effect.succeed(0),
          }),
        ),
        Effect.provideService(
          ActionRunService,
          fromPartial({
            withWorkspaceMutation: <A, E, R>(_id: string, effect: Effect.Effect<A, E, R>) => effect,
            stopWorkspaceRuns: () =>
              Effect.promise(async () => {
                events.push('stopping')
                started.resolve()
                await stopped.promise
                events.push('stopped')
              }),
            cleanupDeletedWorkspaces: Effect.sync(() => {
              events.push('cleanup')
            }),
          }),
        ),
      ),
    )
    await started.promise
    expect(events).toEqual(['stopping'])
    stopped.resolve()
    expect((await deletion)._tag).toBe('Failure')
    expect(events).toEqual(['stopping', 'stopped', 'commit', 'cleanup'])
  })

  it('leaves local durable state intact when an action cannot stop', async () => {
    let committed = false
    const result = await Effect.runPromiseExit(
      withSessionActionRelease(
        SessionId('session'),
        Effect.sync(() => {
          committed = true
        }),
        'before',
        'delete',
      ).pipe(
        Effect.provideService(
          SessionWorkspaceResourceRepository,
          fromPartial({
            getBound: () => Effect.succeed(localWorkspace()),
            countBindings: () => Effect.succeed(0),
          }),
        ),
        Effect.provideService(
          ActionRunService,
          fromPartial({
            withWorkspaceMutation: <A, E, R>(_id: string, effect: Effect.Effect<A, E, R>) => effect,
            stopWorkspaceRuns: () => Effect.fail(new Error('Process still running')),
          }),
        ),
      ),
    )
    expect(result._tag).toBe('Failure')
    expect(committed).toBe(false)
  })

  it('reacquires the current workspace fence when a preceding handoff changes the binding', async () => {
    const oldFence = Effect.unsafeMakeSemaphore(1)
    const handoffStarted = Promise.withResolvers<void>()
    const completeHandoff = Promise.withResolvers<void>()
    const bindingRead = Promise.withResolvers<void>()
    const events: string[] = []
    let currentWorkspace = 'old'
    const handoff = Effect.runPromise(
      oldFence.withPermits(1)(
        Effect.promise(async () => {
          handoffStarted.resolve()
          await completeHandoff.promise
          currentWorkspace = 'new'
        }),
      ),
    )
    await handoffStarted.promise
    const deletion = Effect.runPromise(
      withSessionActionRelease(
        SessionId('session'),
        Effect.sync(() => {
          events.push(`delete:${currentWorkspace}`)
        }),
        'before',
        'delete',
      ).pipe(
        Effect.provideService(
          SessionWorkspaceResourceRepository,
          fromPartial({
            getBound: () =>
              Effect.sync(() => {
                bindingRead.resolve()
                return localWorkspace(currentWorkspace)
              }),
            countBindings: () => Effect.succeed(0),
          }),
        ),
        Effect.provideService(
          ActionRunService,
          fromPartial({
            withWorkspaceMutation: <A, E, R>(id: string, effect: Effect.Effect<A, E, R>) => {
              const admitted = Effect.sync(() => {
                events.push(`fence:${id}`)
              }).pipe(Effect.zipRight(effect))
              return id === 'old' ? oldFence.withPermits(1)(admitted) : admitted
            },
            stopWorkspaceRuns: (id: string) =>
              Effect.sync(() => {
                events.push(`stop:${id}`)
              }),
            cleanupDeletedWorkspaces: Effect.void,
          }),
        ),
      ),
    )
    await bindingRead.promise
    completeHandoff.resolve()
    await Promise.all([handoff, deletion])
    expect(events).toEqual(['fence:old', 'fence:new', 'stop:new', 'delete:new'])
  })

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
