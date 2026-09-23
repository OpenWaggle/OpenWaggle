import { execFile } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, expect, it, vi } from 'vitest'
import { removeGitWorktree, validateGitWorktreeRemoval } from '../../adapters/git/worktree'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'
import { WorkspacePreparationService } from '../../ports/workspace-preparation-service'
import { removePreparedWorktree } from '../prepared-worktree-removal'
import { NoopActionRunServiceLayer } from './action-run-service-test-layer'

const execFileAsync = promisify(execFile)
let temporaryRoot: string | null = null

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = null
})

it('retains a worktree when Cleanup creates an untracked file after Git preflight', async () => {
  temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'openwaggle-postcleanup-')))
  const projectPath = join(temporaryRoot, 'project')
  const worktreePath = join(temporaryRoot, 'worktree')
  const marker = join(worktreePath, 'created-by-cleanup')
  await execFileAsync('git', ['init', '-q', projectPath])
  await writeFile(join(projectPath, 'README.md'), 'initial\n')
  await execFileAsync('git', ['-C', projectPath, 'add', 'README.md'])
  await execFileAsync('git', [
    '-C',
    projectPath,
    '-c',
    'user.name=OpenWaggle Test',
    '-c',
    'user.email=test@openwaggle.invalid',
    'commit',
    '-qm',
    'initial',
  ])
  await execFileAsync('git', [
    '-C',
    projectPath,
    'worktree',
    'add',
    '-qb',
    'cleanup-test',
    worktreePath,
  ])

  const workspaceId = 'cleanup-workspace'
  const state = fromPartial<WorkspacePreparation>({
    workspaceId,
    revision: 1,
    cleanup: { status: 'idle' },
  })
  const finalizations: unknown[] = []
  const remove = vi.fn(() => removeGitWorktree(projectPath, { path: worktreePath }))
  let validations = 0
  const result = await Effect.runPromise(
    removePreparedWorktree(projectPath, { path: worktreePath }, Effect.promise(remove), {
      retryFailed: true,
      validateRemoval: Effect.promise(() => {
        validations += 1
        return validateGitWorktreeRemoval(projectPath, { path: worktreePath })
      }),
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NoopActionRunServiceLayer,
          Layer.succeed(
            SessionWorkspaceResourceRepository,
            fromPartial<SessionWorkspaceResourceRepository['Type']>({
              listManagedWorktreeRemovalCandidates: () =>
                Effect.succeed([{ id: workspaceId, projectPath, workingPath: worktreePath }]),
              admitManagedWorktreeRemoval: () =>
                Effect.succeed({
                  status: 'reserved',
                  resourceId: workspaceId,
                  createdReservation: false,
                }),
              finalizeManagedWorktreeRemoval: (input: {
                readonly resourceId: string
                readonly createdReservation: boolean
                readonly removed: boolean
              }) =>
                Effect.sync(() => {
                  finalizations.push(input)
                }),
            }),
          ),
          Layer.succeed(
            WorkspacePreparationService,
            fromPartial<WorkspacePreparationService['Type']>({
              read: () => Effect.succeed(state),
              isCurrentWorkspaceGeneration: () => Effect.succeed(true),
              run: () =>
                Effect.promise(async () => {
                  await writeFile(marker, 'created during cleanup\n')
                  return fromPartial<WorkspacePreparation>({
                    ...state,
                    cleanup: { status: 'succeeded' },
                  })
                }),
            }),
          ),
        ),
      ),
    ),
  )

  expect(result).toMatchObject({ ok: false, code: 'dirty-worktree' })
  expect(validations).toBe(2)
  expect(remove).not.toHaveBeenCalled()
  expect(await readFile(marker, 'utf8')).toBe('created during cleanup\n')
  expect(finalizations).toEqual([
    { resourceId: workspaceId, createdReservation: false, removed: false },
  ])
})
