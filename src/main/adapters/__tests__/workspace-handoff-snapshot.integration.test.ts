import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGit } from '../git/run-git'
import {
  applyWorkspaceHandoffSeed,
  assertWorkspaceMatchesHandoffSeed,
  captureWorkspaceHandoffSeed,
  releaseWorkspaceHandoffSeed,
  restoreWorkspaceHandoffSeed,
} from '../git/workspace-handoff-snapshot'
import { createGitWorktree } from '../git/worktree'

async function git(cwd: string, args: string[]) {
  const result = await runGit(cwd, args)
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

describe('Workspace handoff snapshots', () => {
  let temporaryRoot = ''
  let repository = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-handoff-seed-'))
    repository = path.join(temporaryRoot, 'repository')
    await fs.mkdir(repository)
    await git(repository, ['init', '-b', 'main'])
    await git(repository, ['config', 'user.name', 'OpenWaggle Test'])
    await git(repository, ['config', 'user.email', 'test@openwaggle.local'])
    await fs.writeFile(path.join(repository, 'tracked.txt'), 'before\n')
    await fs.writeFile(path.join(repository, '.gitignore'), 'ignored.txt\n')
    await git(repository, ['add', '.'])
    await git(repository, ['commit', '-m', 'initial'])
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('carries tracked and untracked Git state and replays safely', async () => {
    await fs.writeFile(path.join(repository, 'tracked.txt'), 'staged\n')
    await fs.writeFile(path.join(repository, 'staged-only.txt'), 'staged only\n')
    await git(repository, ['add', 'tracked.txt', 'staged-only.txt'])
    await fs.writeFile(path.join(repository, 'tracked.txt'), 'unstaged after staged\n')
    await fs.writeFile(path.join(repository, 'untracked.txt'), 'new\n')
    await fs.writeFile(path.join(repository, 'ignored.txt'), 'private\n')
    const seed = await captureWorkspaceHandoffSeed({
      projectPath: repository,
      workingPath: repository,
      workspaceId: 'workspace-target',
    })
    const target = path.join(temporaryRoot, 'target')
    const created = await createGitWorktree(repository, {
      path: target,
      branch: 'ow/session-workspace-target',
      baseRef: seed.sourceHead,
    })
    expect(created.ok).toBe(true)

    await applyWorkspaceHandoffSeed({
      projectPath: repository,
      workingPath: target,
      sourceHead: seed.sourceHead,
      snapshotRef: seed.snapshotRef,
    })
    await expect(fs.readFile(path.join(target, 'tracked.txt'), 'utf8')).resolves.toBe(
      'unstaged after staged\n',
    )
    await expect(fs.readFile(path.join(target, 'staged-only.txt'), 'utf8')).resolves.toBe(
      'staged only\n',
    )
    await expect(fs.readFile(path.join(target, 'untracked.txt'), 'utf8')).resolves.toBe('new\n')
    await expect(fs.access(path.join(target, 'ignored.txt'))).rejects.toThrow()
    await expect(git(target, ['status', '--porcelain'])).resolves.toBe(
      ['A  staged-only.txt', 'MM tracked.txt', '?? untracked.txt'].join('\n'),
    )

    await applyWorkspaceHandoffSeed({
      projectPath: repository,
      workingPath: target,
      sourceHead: seed.sourceHead,
      snapshotRef: seed.snapshotRef,
    })
    await fs.writeFile(path.join(repository, 'tracked.txt'), 'later\n')
    await expect(
      captureWorkspaceHandoffSeed({
        projectPath: repository,
        workingPath: repository,
        workspaceId: 'workspace-target',
      }),
    ).resolves.toEqual(seed)

    await releaseWorkspaceHandoffSeed(repository, seed.snapshotRef)
    const released = await runGit(repository, ['rev-parse', '--verify', seed.snapshotRef])
    expect(released.code).not.toBe(0)
  }, 60_000)

  it('restores a transferred target exactly and preserves later user edits', async () => {
    await fs.writeFile(path.join(repository, 'tracked.txt'), 'source state\n')
    await fs.writeFile(path.join(repository, 'source-only.txt'), 'source only\n')
    const source = await captureWorkspaceHandoffSeed({
      projectPath: repository,
      workingPath: repository,
      workspaceId: 'rollback-source',
    })
    const target = path.join(temporaryRoot, 'rollback-target')
    expect(
      (
        await createGitWorktree(repository, {
          path: target,
          branch: 'ow/rollback-target',
          baseRef: source.sourceHead,
        })
      ).ok,
    ).toBe(true)
    const targetBaseline = await captureWorkspaceHandoffSeed({
      projectPath: repository,
      workingPath: target,
      workspaceId: 'rollback-target-baseline',
    })

    await applyWorkspaceHandoffSeed({
      projectPath: repository,
      workingPath: target,
      sourceHead: source.sourceHead,
      snapshotRef: source.snapshotRef,
    })
    await restoreWorkspaceHandoffSeed({
      projectPath: repository,
      workingPath: target,
      sourceHead: source.sourceHead,
      appliedSnapshotRef: source.snapshotRef,
      targetSnapshotRef: targetBaseline.snapshotRef,
    })
    await expect(fs.readFile(path.join(target, 'tracked.txt'), 'utf8')).resolves.toBe('before\n')
    await expect(fs.access(path.join(target, 'source-only.txt'))).rejects.toThrow()

    await applyWorkspaceHandoffSeed({
      projectPath: repository,
      workingPath: target,
      sourceHead: source.sourceHead,
      snapshotRef: source.snapshotRef,
    })
    await fs.writeFile(path.join(target, 'tracked.txt'), 'user edit after transfer\n')
    await expect(
      restoreWorkspaceHandoffSeed({
        projectPath: repository,
        workingPath: target,
        sourceHead: source.sourceHead,
        appliedSnapshotRef: source.snapshotRef,
        targetSnapshotRef: targetBaseline.snapshotRef,
      }),
    ).rejects.toThrow('rollback preserved user edits')
    await expect(fs.readFile(path.join(target, 'tracked.txt'), 'utf8')).resolves.toBe(
      'user edit after transfer\n',
    )

    await fs.writeFile(path.join(repository, 'tracked.txt'), 'source changed after admission\n')
    await expect(
      assertWorkspaceMatchesHandoffSeed({
        projectPath: repository,
        workingPath: repository,
        snapshotRef: source.snapshotRef,
      }),
    ).rejects.toThrow('Source Workspace changed after handoff admission.')
  }, 60_000)
})
