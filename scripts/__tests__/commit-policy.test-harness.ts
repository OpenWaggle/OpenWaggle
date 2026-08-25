/** Real-git fixtures for the Conventional Commit policy tests, shared by the merge and release-intent suites. */
import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
export const POLICY_SCRIPT_PATH = 'scripts/check-conventional-commits.ts'
export const GIT_IDENTITY = [
  '-c',
  'user.name=OpenWaggle Tests',
  '-c',
  'user.email=tests@openwaggle.ai',
] as const

export async function git(cwd: string, args: readonly string[]) {
  const { stdout } = await execFile('git', args, { cwd })
  return stdout.trim()
}

export async function writeAndCommit(
  cwd: string,
  filePath: string,
  contents: string,
  message: string,
) {
  const absolutePath = path.join(cwd, filePath)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, contents, 'utf8')
  await git(cwd, ['add', filePath])
  await git(cwd, [...GIT_IDENTITY, 'commit', '-m', message])
  return git(cwd, ['rev-parse', 'HEAD'])
}

export async function createRepository() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-commit-policy-'))
  await git(cwd, ['init', '-b', 'main'])
  await writeAndCommit(cwd, 'history.txt', 'history\n', 'historical commit')
  const baseline = await writeAndCommit(
    cwd,
    POLICY_SCRIPT_PATH,
    'current policy marker\n',
    'ci: introduce commit policy',
  )
  return { baseline, cwd }
}

export async function merge(cwd: string, branch: string, message: string) {
  await git(cwd, [...GIT_IDENTITY, 'merge', '--no-ff', branch, '-m', message])
  return git(cwd, ['rev-parse', 'HEAD'])
}
