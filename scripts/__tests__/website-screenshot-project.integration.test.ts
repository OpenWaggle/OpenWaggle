import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createScreenshotProject,
  OUTPUT_IMAGE_RELATIVE_PATH,
} from '../website-screenshot-project'

const execFileAsync = promisify(execFile)
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

async function git(cwd: string, args: readonly string[]) {
  return (await execFileAsync('git', [...args], { cwd })).stdout.trim()
}

describe('website screenshot project', () => {
  let scratch = ''

  beforeEach(async () => {
    scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-shots-project-')))
  })

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true })
  })

  it('is a repository with one README change and managed worktrees under the scratch HOME', async () => {
    const homeDir = path.join(scratch, 'home')
    const project = await createScreenshotProject({
      rootDir: ROOT_DIR,
      projectPath: path.join(scratch, 'OpenWaggle'),
      homeDir,
      worktreeIds: ['3f9c2a1e', '7b41d0c8'],
    })

    expect(await git(project.projectPath, ['status', '--porcelain'])).toBe('M README.md')
    expect(project.outputImagePath).toBe(path.join(project.projectPath, OUTPUT_IMAGE_RELATIVE_PATH))
    expect(await git(project.projectPath, ['ls-files', OUTPUT_IMAGE_RELATIVE_PATH])).toBe(
      OUTPUT_IMAGE_RELATIVE_PATH,
    )
    const worktreeRoot = path.join(homeDir, '.openwaggle', 'worktrees', 'OpenWaggle')
    expect(project.worktrees).toEqual([
      { id: '3f9c2a1e', path: path.join(worktreeRoot, '3f9c2a1e'), branch: 'ow/session-3f9c2a1e' },
      { id: '7b41d0c8', path: path.join(worktreeRoot, '7b41d0c8'), branch: 'ow/session-7b41d0c8' },
    ])
    const listed = await git(project.projectPath, ['worktree', 'list', '--porcelain'])
    for (const worktree of project.worktrees) {
      expect(listed).toContain(`worktree ${worktree.path}`)
      expect(listed).toContain(`branch refs/heads/${worktree.branch}`)
    }
  })
})
