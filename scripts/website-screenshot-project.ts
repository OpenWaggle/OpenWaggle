import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { sessionWorktreeBranchForId } from '@shared/utils/worktree'

const execFileAsync = promisify(execFile)

const GIT_IDENTITY = [
  '-c',
  'user.name=OpenWaggle Screenshot Fixture',
  '-c',
  'user.email=screenshots@openwaggle.local',
] as const

/** Checked-in art the fixture project shows as an image an agent produced. */
const OUTPUT_IMAGE_SOURCE = path.join('website', 'public', 'og', 'openwaggle.png')
/** Fixed ids, so the worktree paths and branches read the same in every capture. */
export const SCREENSHOT_WORKTREE_IDS = ['3f9c2a1e', '7b41d0c8'] as const

export const OUTPUT_IMAGE_RELATIVE_PATH = path.join('docs', 'release-notes-preview.png')

export interface ScreenshotWorktree {
  readonly id: string
  readonly path: string
  readonly branch: string
}

export interface ScreenshotProject {
  readonly projectPath: string
  readonly outputImagePath: string
  readonly worktrees: readonly ScreenshotWorktree[]
}

function git(cwd: string, args: readonly string[]) {
  return execFileAsync('git', [...GIT_IDENTITY, ...args], { cwd })
}

/**
 * A real Git repository with an uncommitted README change (the diff screenshot), an image file
 * an agent shows as its result (Outputs), and two managed worktrees under the scratch HOME, where
 * OpenWaggle creates its own (Settings > Worktrees, the Hive's Workspace column).
 */
export async function createScreenshotProject(input: {
  readonly rootDir: string
  readonly projectPath: string
  readonly homeDir: string
  readonly worktreeIds: readonly string[]
}): Promise<ScreenshotProject> {
  const { projectPath } = input
  await fs.mkdir(projectPath, { recursive: true })
  await git(projectPath, ['init', '--initial-branch=main'])
  const readmePath = path.join(projectPath, 'README.md')
  await fs.writeFile(readmePath, '# OpenWaggle screenshot fixture\n', 'utf8')
  // Committed, so only the README change shows in the diff.
  const outputImagePath = path.join(await fs.realpath(projectPath), OUTPUT_IMAGE_RELATIVE_PATH)
  await fs.mkdir(path.dirname(outputImagePath), { recursive: true })
  await fs.copyFile(path.join(input.rootDir, OUTPUT_IMAGE_SOURCE), outputImagePath)
  await git(projectPath, ['add', 'README.md', OUTPUT_IMAGE_RELATIVE_PATH])
  await git(projectPath, ['commit', '-m', 'chore: seed screenshot fixture'])

  const realProjectPath = await fs.realpath(projectPath)
  const worktreeRoot = path.join(input.homeDir, '.openwaggle', 'worktrees', path.basename(realProjectPath))
  await fs.mkdir(worktreeRoot, { recursive: true })
  const worktrees: ScreenshotWorktree[] = []
  for (const id of input.worktreeIds) {
    const worktreePath = path.join(await fs.realpath(worktreeRoot), id)
    const branch = sessionWorktreeBranchForId(id)
    await git(realProjectPath, ['worktree', 'add', '-b', branch, worktreePath, 'main'])
    worktrees.push({ id, path: worktreePath, branch })
  }

  await fs.writeFile(
    readmePath,
    '# OpenWaggle screenshot fixture\n\nDocument the pending release review.\n',
    'utf8',
  )
  return { projectPath: realProjectPath, outputImagePath, worktrees }
}
