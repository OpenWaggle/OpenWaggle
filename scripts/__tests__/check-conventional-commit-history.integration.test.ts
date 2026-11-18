/** The commit policy over real git histories: the ranges it checks and where it starts. */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateConventionalCommits } from '../check-conventional-commits'
import { GIT_IDENTITY, POLICY_SCRIPT_PATH, git, writeAndCommit } from './commit-policy.test-harness'

const ALL_ZERO_SHA = '0000000000000000000000000000000000000000'
const TEMP_REPOSITORY_REMOVE_OPTIONS = {
  force: true,
  maxRetries: 10,
  recursive: true,
  retryDelay: 100,
} as const

async function commit(cwd: string, message: string) {
  const filePath = path.join(cwd, 'history.txt')
  const currentContents = await fs.readFile(filePath, 'utf8').catch(() => '')
  await fs.writeFile(filePath, `${currentContents}${message}\n`, 'utf8')
  await git(cwd, ['add', 'history.txt'])
  await git(cwd, [...GIT_IDENTITY, 'commit', '-m', message])
  return git(cwd, ['rev-parse', 'HEAD'])
}

describe('Conventional Commit policy over git history', () => {
  it('validates a pull request title because GitHub uses it for squash commits', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-commit-policy-'))
    try {
      await git(cwd, ['init'])
      await commit(cwd, 'historical commit without a Conventional Commit subject')
      const baseline = await writeAndCommit(
        cwd,
        POLICY_SCRIPT_PATH,
        'current policy marker\n',
        'ci: introduce commit policy',
      )
      const head = await writeAndCommit(
        cwd,
        'packages/extension-sdk/src/manifest.ts',
        'export const manifest = {}\n',
        'fix(extension-sdk): validate manifest ids',
      )

      const valid = await validateConventionalCommits({
        baseline,
        cwd,
        prTitle: 'feat(extension-sdk): expose manifest helpers',
        to: head,
      })
      const invalid = await validateConventionalCommits({
        baseline,
        cwd,
        prTitle: 'Expose manifest helpers',
        to: head,
      })

      expect(valid.violations).toEqual([])
      expect(invalid.violations).toContain(
        'Pull request title "Expose manifest helpers" is not an allowed Conventional Commit subject.',
      )

      const missingReleaseIntent = await validateConventionalCommits({
        baseline,
        cwd,
        prTitle: 'docs(extension-sdk): explain manifest helpers',
        to: head,
      })
      expect(missingReleaseIntent.violations).toContain(
        'Pull request title "docs(extension-sdk): explain manifest helpers" changes a publishable package but would not create a Release Please version bump.',
      )
    } finally {
      await fs.rm(cwd, TEMP_REPOSITORY_REMOVE_OPTIONS)
    }
  })

  it('allows non-release titles when no publishable package changes', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-commit-policy-'))
    try {
      await git(cwd, ['init'])
      const baseline = await writeAndCommit(
        cwd,
        POLICY_SCRIPT_PATH,
        'current policy marker\n',
        'ci: introduce commit policy',
      )
      const head = await writeAndCommit(
        cwd,
        'website/src/content/docs/index.md',
        '# Docs\n',
        'docs: improve website copy',
      )

      const result = await validateConventionalCommits({
        baseline,
        cwd,
        prTitle: 'docs: improve website copy',
        to: head,
      })

      expect(result.violations).toEqual([])
    } finally {
      await fs.rm(cwd, TEMP_REPOSITORY_REMOVE_OPTIONS)
    }
  })

  it('uses the bootstrap baseline for all-zero pushes and honors explicit from/to ranges', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-commit-policy-'))
    try {
      await git(cwd, ['init'])
      await commit(cwd, 'historical commit without a Conventional Commit subject')
      const baseline = await commit(cwd, 'build: add publishable OpenWaggle packages')
      const validCommit = await commit(cwd, 'fix(extension-sdk): validate manifest ids')
      const invalidCommit = await commit(cwd, 'implement range validation')

      const allZeroPush = await validateConventionalCommits({
        baseline,
        cwd,
        from: ALL_ZERO_SHA,
        to: invalidCommit,
      })
      const dispatchedRef = await validateConventionalCommits({
        baseline,
        cwd,
        from: '',
        to: invalidCommit,
      })
      const explicitRange = await validateConventionalCommits({
        baseline,
        cwd,
        from: validCommit,
        to: invalidCommit,
      })

      expect(allZeroPush.violations).toEqual([
        `${invalidCommit}: "implement range validation" is not an allowed Conventional Commit subject.`,
      ])
      expect(dispatchedRef.violations).toEqual(allZeroPush.violations)
      expect(explicitRange.effectiveFrom).toBe(validCommit)
      expect(explicitRange.violations).toEqual(allZeroPush.violations)
    } finally {
      await fs.rm(cwd, TEMP_REPOSITORY_REMOVE_OPTIONS)
    }
  })

  it('derives the activation marker from squash-style current history instead of an abandoned SHA', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-commit-policy-'))
    try {
      await git(cwd, ['init'])
      const historicalCommit = await commit(
        cwd,
        'historical commit without a Conventional Commit subject',
      )
      const abandonedMarker = await writeAndCommit(
        cwd,
        POLICY_SCRIPT_PATH,
        'legacy policy marker\n',
        'ci: introduce commit policy',
      )

      await git(cwd, ['checkout', '-b', 'squashed-main', historicalCommit])
      const currentMarker = await writeAndCommit(
        cwd,
        POLICY_SCRIPT_PATH,
        'current policy marker\n',
        'ci: introduce commit policy',
      )
      const invalidCommit = await commit(cwd, 'implement squash-safe policy activation')

      const result = await validateConventionalCommits({ cwd, to: invalidCommit })
      const disconnectedRange = await validateConventionalCommits({
        cwd,
        from: abandonedMarker,
        to: invalidCommit,
      })

      expect(result.effectiveFrom).toBe(currentMarker)
      expect(result.effectiveFrom).not.toBe(abandonedMarker)
      expect(result.violations).toEqual([
        `${invalidCommit}: "implement squash-safe policy activation" is not an allowed Conventional Commit subject.`,
      ])
      expect(disconnectedRange.effectiveFrom).toBe(currentMarker)
      expect(disconnectedRange.violations).toEqual(result.violations)
    } finally {
      await fs.rm(cwd, TEMP_REPOSITORY_REMOVE_OPTIONS)
    }
  })

  it('does not exempt an authored single-parent subject that starts with Merge', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-commit-policy-'))
    try {
      await git(cwd, ['init'])
      await commit(cwd, 'historical commit without a Conventional Commit subject')
      await writeAndCommit(
        cwd,
        POLICY_SCRIPT_PATH,
        'current policy marker\n',
        'ci: introduce commit policy',
      )
      const authoredCommit = await commit(cwd, 'Merge package release policy')

      const result = await validateConventionalCommits({ cwd, to: authoredCommit })

      expect(result.violations).toEqual([
        `${authoredCommit}: "Merge package release policy" is not an allowed Conventional Commit subject.`,
      ])
    } finally {
      await fs.rm(cwd, TEMP_REPOSITORY_REMOVE_OPTIONS)
    }
  })
})
