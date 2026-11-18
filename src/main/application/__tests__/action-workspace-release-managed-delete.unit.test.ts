import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { ActionRunService } from '../../ports/action-run-service'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'
import { withSessionActionRelease } from '../action-workspace-release'

const managedWorkspace = {
  id: 'worktree',
  projectPath: '/project',
  workingPath: '/project/.worktrees/feature',
  kind: 'managed-worktree' as const,
  pending: false,
  worktreeBranch: 'feature',
}

describe('managed worktree Session deletion', () => {
  it('keeps services running when Git rejects a dirty worktree before deletion commits', async () => {
    const events: string[] = []
    const result = await Effect.runPromiseExit(
      withSessionActionRelease(
        SessionId('session'),
        Effect.sync(() => {
          events.push('validate:dirty')
        }).pipe(Effect.zipRight(Effect.fail(new Error('Worktree has uncommitted changes.')))),
        'before',
        'delete',
      ).pipe(
        Effect.provideService(
          SessionWorkspaceResourceRepository,
          fromPartial({
            getBound: () => Effect.succeed(managedWorkspace),
            countActiveBindings: (_id: string, excluding?: SessionId) =>
              Effect.succeed(excluding ? 0 : 1),
          }),
        ),
        Effect.provideService(
          ActionRunService,
          fromPartial({
            withWorkspaceMutation: <A, E, R>(_id: string, effect: Effect.Effect<A, E, R>) => effect,
            stopWorkspaceServices: () =>
              Effect.sync(() => {
                events.push('stop-services')
              }),
            cleanupDeletedWorkspaces: Effect.void,
          }),
        ),
      ),
    )
    expect(result._tag).toBe('Failure')
    expect(events).toEqual(['validate:dirty'])
  })

  it('stops orphaned services after managed deletion completes', async () => {
    const events: string[] = []
    let activeBindings = 1
    await Effect.runPromise(
      withSessionActionRelease(
        SessionId('session'),
        Effect.sync(() => {
          events.push('validate:clean', 'delete')
          activeBindings = 0
        }),
        'before',
        'delete',
      ).pipe(
        Effect.provideService(
          SessionWorkspaceResourceRepository,
          fromPartial({
            getBound: () => Effect.succeed(managedWorkspace),
            countActiveBindings: (_id: string, excluding?: SessionId) =>
              Effect.succeed(excluding ? 0 : activeBindings),
          }),
        ),
        Effect.provideService(
          ActionRunService,
          fromPartial({
            withWorkspaceMutation: <A, E, R>(_id: string, effect: Effect.Effect<A, E, R>) => effect,
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
    expect(events).toEqual(['validate:clean', 'delete', 'stop-services', 'cleanup'])
  })

  it('stops orphaned services if deletion fails after the Session is unbound', async () => {
    const events: string[] = []
    let activeBindings = 1
    const result = await Effect.runPromiseExit(
      withSessionActionRelease(
        SessionId('session'),
        Effect.sync(() => {
          events.push('commit-delete')
          activeBindings = 0
        }).pipe(Effect.zipRight(Effect.fail(new Error('Worktree cleanup failed.')))),
        'before',
        'delete',
      ).pipe(
        Effect.provideService(
          SessionWorkspaceResourceRepository,
          fromPartial({
            getBound: () => Effect.succeed(managedWorkspace),
            countActiveBindings: () => Effect.succeed(activeBindings),
          }),
        ),
        Effect.provideService(
          ActionRunService,
          fromPartial({
            withWorkspaceMutation: <A, E, R>(_id: string, effect: Effect.Effect<A, E, R>) => effect,
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
    expect(result._tag).toBe('Failure')
    expect(events).toEqual(['commit-delete', 'stop-services', 'cleanup'])
  })
})
