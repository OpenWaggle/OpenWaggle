import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, expect, it, vi } from 'vitest'
import { ActionRunService } from '../../ports/action-run-service'
import { GitWorktreeService } from '../../ports/git-worktree-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import {
  type SessionWorkspaceResource,
  SessionWorkspaceResourceRepository,
} from '../../ports/session-workspace-resource-repository'
import { createHostUiWorktree } from '../host-ui-worktree-operation'
import { NoopWorkspacePreparationLayer } from './workspace-preparation-test-layer'

vi.mock('../../services/git-status-cache', () => ({ invalidateGitStatusCache: vi.fn() }))

let temporaryRoot = ''
afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = ''
})

it('stops stale action runs and fences missing-checkout recreation before another action starts', async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-recreate-actions-'))
  const projectPath = path.join(temporaryRoot, 'project')
  const workingPath = path.join(temporaryRoot, 'missing-worktree')
  await mkdir(projectPath)
  const events: string[] = []
  const lock = Effect.unsafeMakeSemaphore(1)
  const workspace = fromPartial<SessionWorkspaceResource>({
    id: 'bound-workspace',
    kind: 'managed-worktree',
    projectPath,
    workingPath,
    worktreeBranch: 'bound-branch',
    pending: false,
  })
  let finishCreate: () => void = () => undefined
  const gitCreate = vi.fn(async () => {
    events.push('git-create')
    await new Promise<void>((resolve) => {
      finishCreate = resolve
    })
    return { ok: true as const, path: workingPath, message: 'Created worktree.' }
  })
  const layer = Layer.mergeAll(
    NoopWorkspacePreparationLayer,
    Layer.succeed(
      SessionWorkspaceResourceRepository,
      fromPartial<SessionWorkspaceResourceRepository['Type']>({
        getBound: () => Effect.succeed(workspace),
      }),
    ),
    Layer.succeed(
      SessionProjectionRepository,
      fromPartial<SessionProjectionRepository['Type']>({
        resetWorktreeSetup: () => Effect.void,
      }),
    ),
    Layer.succeed(
      GitWorktreeService,
      fromPartial<GitWorktreeService['Type']>({
        create: () => Effect.promise(gitCreate),
      }),
    ),
    Layer.succeed(
      ActionRunService,
      fromPartial<ActionRunService['Type']>({
        stopWorkspaceRuns: (workspaceId: string) =>
          Effect.sync(() => {
            events.push(`stop:${workspaceId}`)
          }),
        withWorkspaceMutation: <A, E, R>(_workspaceId: string, operation: Effect.Effect<A, E, R>) =>
          lock.withPermits(1)(operation),
      }),
    ),
  )
  const creation = Effect.runPromise(
    createHostUiWorktree(projectPath, {
      path: '/ignored-renderer-path',
      branch: 'ignored-renderer-branch',
      baseRef: 'main',
      sessionId: 'session',
    }).pipe(Effect.provide(layer)),
  )
  await vi.waitFor(() => expect(gitCreate).toHaveBeenCalledOnce())
  expect(events).toEqual(['stop:bound-workspace', 'git-create'])

  const nextAction = Effect.runPromise(
    lock.withPermits(1)(Effect.sync(() => events.push('new-action'))),
  )
  await Promise.resolve()
  expect(events).not.toContain('new-action')
  finishCreate()
  await expect(creation).resolves.toMatchObject({ ok: true })
  await nextAction
  expect(events).toEqual(['stop:bound-workspace', 'git-create', 'new-action'])
})
