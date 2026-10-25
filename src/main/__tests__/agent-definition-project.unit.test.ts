import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeProjectResolver } from './agent-definition-project.test-support'

describe('resolveAgentDefinitionProject', () => {
  let root = ''
  let project = ''
  let worktree = ''

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ow-agent-project-')))
    project = path.join(root, 'project')
    worktree = path.join(root, 'worktrees', 'project', 'w1')
    await fs.mkdir(path.join(project, 'src', 'deep'), { recursive: true })
    await fs.mkdir(path.join(worktree, 'src'), { recursive: true })
  })

  afterEach(async () => fs.rm(root, { recursive: true, force: true }))

  const resolver = () =>
    fakeProjectResolver({
      projects: [project],
      worktrees: { [worktree]: project },
      toggles: () => ({ [project]: { reviewer: false } }),
    })

  it('reads the project root and its toggles from a managed worktree and below it', async () => {
    for (const directory of [worktree, path.join(worktree, 'src')]) {
      await expect(resolver()(directory)).resolves.toEqual({
        projectPath: project,
        enabledByName: { reviewer: false },
      })
    }
  })

  it('reads the project root and its toggles from a subdirectory', async () => {
    await expect(resolver()(path.join(project, 'src', 'deep'))).resolves.toEqual({
      projectPath: project,
      enabledByName: { reviewer: false },
    })
  })

  it('keeps a project the user opened, even when it is also a worktree', async () => {
    const resolve = fakeProjectResolver({
      projects: [worktree, project],
      worktrees: { [worktree]: project },
    })
    await expect(resolve(worktree)).resolves.toMatchObject({ projectPath: worktree })
  })

  it('treats a directory OpenWaggle does not know as its own project', async () => {
    const elsewhere = path.join(root, 'elsewhere')
    await expect(resolver()(elsewhere)).resolves.toEqual({
      projectPath: elsewhere,
      enabledByName: {},
    })
  })

  it('fails when Settings cannot be read', async () => {
    const resolve = fakeProjectResolver({
      projects: [project],
      settingsError: new Error('OpenWaggle could not read the saved settings database.'),
    })
    await expect(resolve(project)).rejects.toThrow('could not read the saved settings database')
  })
})
