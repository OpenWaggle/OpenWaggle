import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runGit } from './run-git'

export async function requiredGit(projectPath: string, args: string[], operation: string) {
  const result = await runGit(projectPath, args)
  if (result.code !== 0) {
    throw new Error(`${operation} failed: ${result.stderr.trim() || 'Git returned an error.'}`)
  }
  return result.stdout.trim()
}

async function requiredGitWithEnv(
  projectPath: string,
  args: string[],
  env: Readonly<Record<string, string>>,
  operation: string,
) {
  const result = await runGit(projectPath, args, { env })
  if (result.code !== 0) {
    throw new Error(`${operation} failed: ${result.stderr.trim() || 'Git returned an error.'}`)
  }
  return result.stdout.trim()
}

export async function indexTree(workingPath: string) {
  return requiredGit(workingPath, ['write-tree'], 'Writing Workspace index snapshot')
}

export async function worktreeTree(workingPath: string, baseTree?: string) {
  const scratchRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-handoff-'))
  const indexFile = path.join(scratchRoot, 'index')
  const env = { GIT_INDEX_FILE: indexFile }
  try {
    await requiredGitWithEnv(
      workingPath,
      ['read-tree', baseTree ?? 'HEAD'],
      env,
      'Reading Workspace index',
    )
    await requiredGitWithEnv(
      workingPath,
      ['add', '-A', '--', ':/'],
      env,
      'Snapshotting Workspace files',
    )
    return await requiredGitWithEnv(workingPath, ['write-tree'], env, 'Writing Workspace snapshot')
  } finally {
    await rm(scratchRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function applyTreeDelta(input: {
  readonly projectPath: string
  readonly workingPath: string
  readonly from: string
  readonly to: string
  readonly cached: boolean
  readonly operation: string
}) {
  const scratchRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-handoff-patch-'))
  const patchPath = path.join(scratchRoot, 'state.patch')
  try {
    await requiredGit(
      input.projectPath,
      ['diff', '--binary', '--full-index', `--output=${patchPath}`, input.from, input.to, '--'],
      `Preparing ${input.operation}`,
    )
    await requiredGit(
      input.workingPath,
      [
        'apply',
        ...(input.cached ? ['--cached'] : []),
        '--allow-empty',
        '--binary',
        '--whitespace=nowarn',
        patchPath,
      ],
      `Applying ${input.operation}`,
    )
  } finally {
    await rm(scratchRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}
