import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { validateConventionalCommits } from '../check-conventional-commits'

const execFile = promisify(execFileCallback)
const POLICY_SCRIPT_PATH = 'scripts/check-conventional-commits.ts'
const GIT_IDENTITY = [
  '-c',
  'user.name=OpenWaggle Tests',
  '-c',
  'user.email=tests@openwaggle.ai',
] as const

async function git(cwd: string, args: readonly string[]) {
  const { stdout } = await execFile('git', args, { cwd })
  return stdout.trim()
}

async function writeAndCommit(
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

async function createRepository() {
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

async function merge(cwd: string, branch: string, message: string) {
  await git(cwd, [...GIT_IDENTITY, 'merge', '--no-ff', branch, '-m', message])
  return git(cwd, ['rev-parse', 'HEAD'])
}

describe('Conventional Commit PR title release intent', () => {
  it('does not demand release intent in the PR title for an exempt sync merge', async () => {
    /*
     * The exemption previously covered only the commit-level rule, so the merge commit passed while
     * the PR *title* was still required to carry release intent for `packages/` changes that were
     * already released on the base branch and were never this PR's to bump.
     */
    const { baseline, cwd } = await createRepository()
    try {
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/package.json',
        '{"version":"0.2.0"}\n',
        'fix(extension-sdk): update package metadata',
      )
      const baseRef = await git(cwd, ['rev-parse', 'HEAD'])

      await git(cwd, ['checkout', '-b', 'feature', baseline])
      await writeAndCommit(cwd, 'src/feature.ts', 'export {}\n', 'feat(app): add a feature')
      const updateMerge = await merge(cwd, 'main', "Merge branch 'main' into feature")

      const result = await validateConventionalCommits({
        baseline,
        cwd,
        from: baseRef,
        to: updateMerge,
        // A title with no release intent: `docs:` never triggers a Release Please bump.
        prTitle: 'docs(app): describe the feature',
      })

      expect(result.violations).toEqual([])
    } finally {
      await fs.rm(cwd, { force: true, recursive: true })
    }
  })

  it('still demands release intent in the PR title for the branch\'s own package change', async () => {
    const { baseline, cwd } = await createRepository()
    try {
      const baseRef = await git(cwd, ['rev-parse', 'HEAD'])
      await git(cwd, ['checkout', '-b', 'feature'])
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/index.ts',
        'export {}\n',
        'feat(extension-sdk): add an export',
      )
      const head = await git(cwd, ['rev-parse', 'HEAD'])

      const result = await validateConventionalCommits({
        baseline,
        cwd,
        from: baseRef,
        to: head,
        prTitle: 'docs(app): describe the feature',
      })

      expect(result.violations).toHaveLength(1)
      expect(result.violations[0]).toContain('would not create a Release Please version bump')
    } finally {
      await fs.rm(cwd, { force: true, recursive: true })
    }
  })
})
