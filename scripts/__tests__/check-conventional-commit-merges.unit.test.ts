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

describe('Conventional Commit merge attribution', () => {
  it('attributes update-branch merges against their first parent', async () => {
    const { baseline, cwd } = await createRepository()
    try {
      await git(cwd, ['checkout', '-b', 'release-please'])
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/package.json',
        '{"version":"0.1.0"}\n',
        'chore(release): release packages',
      )
      await git(cwd, ['checkout', 'main'])
      await writeAndCommit(
        cwd,
        'scripts/release-helper.ts',
        'export {}\n',
        'fix(release): harden release helper',
      )
      await git(cwd, ['checkout', 'release-please'])
      const updateMerge = await merge(cwd, 'main', "Merge branch 'main' into release-please")

      const result = await validateConventionalCommits({ baseline, cwd, to: updateMerge })

      expect(result.violations).toEqual([])
      expect(result.commits.find((item) => item.hash === updateMerge)?.changedPaths).toEqual([
        'scripts/release-helper.ts',
      ])
    } finally {
      await fs.rm(cwd, { force: true, recursive: true })
    }
  })

  it('still rejects package changes merged into the first-parent branch', async () => {
    const { baseline, cwd } = await createRepository()
    try {
      await git(cwd, ['checkout', '-b', 'package-change'])
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/package.json',
        '{"version":"0.1.0"}\n',
        'fix(extension-sdk): update package metadata',
      )
      await git(cwd, ['checkout', 'main'])
      const packageMerge = await merge(
        cwd,
        'package-change',
        'Merge pull request #123 from OpenWaggle/package-change',
      )

      const result = await validateConventionalCommits({ baseline, cwd, to: packageMerge })

      expect(result.violations).toContain(
        `${packageMerge}: "Merge pull request #123 from OpenWaggle/package-change" affects a publishable package and must carry explicit Conventional Commit release intent.`,
      )
    } finally {
      await fs.rm(cwd, { force: true, recursive: true })
    }
  })

  it('retains a package source path when a merge moves it outside packages', async () => {
    const { baseline, cwd } = await createRepository()
    try {
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/api.ts',
        'export {}\n',
        'feat(extension-sdk): add public api',
      )
      await git(cwd, ['checkout', '-b', 'package-move'])
      await fs.mkdir(path.join(cwd, 'src'), { recursive: true })
      await fs.rename(
        path.join(cwd, 'packages/extension-sdk/api.ts'),
        path.join(cwd, 'src/api.ts'),
      )
      await git(cwd, ['add', '--all'])
      await git(cwd, [...GIT_IDENTITY, 'commit', '-m', 'refactor: move package api'])
      await git(cwd, ['checkout', 'main'])
      const packageMerge = await merge(
        cwd,
        'package-move',
        'Merge pull request #124 from OpenWaggle/package-move',
      )

      const result = await validateConventionalCommits({ baseline, cwd, to: packageMerge })
      const mergeCommit = result.commits.find((item) => item.hash === packageMerge)

      expect(mergeCommit?.changedPaths).toEqual([
        'packages/extension-sdk/api.ts',
        'src/api.ts',
      ])
      expect(result.violations).toContain(
        `${packageMerge}: "Merge pull request #124 from OpenWaggle/package-move" affects a publishable package and must carry explicit Conventional Commit release intent.`,
      )
    } finally {
      await fs.rm(cwd, { force: true, recursive: true })
    }
  })

  it('captures single-parent package paths and excludes the policy root baseline', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-commit-policy-'))
    try {
      await git(cwd, ['init', '-b', 'main'])
      const baseline = await writeAndCommit(
        cwd,
        POLICY_SCRIPT_PATH,
        'current policy marker\n',
        'historical root without conventional intent',
      )
      const packageCommit = await writeAndCommit(
        cwd,
        'packages/extension-sdk/api.ts',
        'export {}\n',
        'fix(extension-sdk): expose package api',
      )

      const result = await validateConventionalCommits({ cwd, to: packageCommit })

      expect(result.effectiveFrom).toBe(baseline)
      expect(result.commits).toHaveLength(1)
      expect(result.commits[0]).toMatchObject({
        changedPaths: ['packages/extension-sdk/api.ts'],
        hash: packageCommit,
      })
      expect(result.violations).toEqual([])
    } finally {
      await fs.rm(cwd, { force: true, recursive: true })
    }
  })
})
