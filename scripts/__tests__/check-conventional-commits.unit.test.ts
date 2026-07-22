import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  validateConventionalCommits,
  validateConventionalCommitSubjects,
} from '../check-conventional-commits'

const execFile = promisify(execFileCallback)
const ALL_ZERO_SHA = '0000000000000000000000000000000000000000'
const POLICY_SCRIPT_PATH = 'scripts/check-conventional-commits.ts'

async function git(cwd: string, args: readonly string[]) {
  const { stdout } = await execFile('git', args, { cwd })

  return stdout.trim()
}

async function commit(cwd: string, message: string) {
  const filePath = path.join(cwd, 'history.txt')
  const currentContents = await fs.readFile(filePath, 'utf8').catch(() => '')
  await fs.writeFile(filePath, `${currentContents}${message}\n`, 'utf8')
  await git(cwd, ['add', 'history.txt'])
  await git(cwd, [
    '-c',
    'user.name=OpenWaggle Tests',
    '-c',
    'user.email=tests@openwaggle.ai',
    'commit',
    '-m',
    message,
  ])

  return git(cwd, ['rev-parse', 'HEAD'])
}

async function writeAndCommit(cwd: string, filePath: string, contents: string, message: string) {
  const absolutePath = path.join(cwd, filePath)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, contents, 'utf8')
  await git(cwd, ['add', filePath])
  await git(cwd, [
    '-c',
    'user.name=OpenWaggle Tests',
    '-c',
    'user.email=tests@openwaggle.ai',
    'commit',
    '-m',
    message,
  ])

  return git(cwd, ['rev-parse', 'HEAD'])
}

describe('Conventional Commit policy', () => {
  it('accepts allowed scoped and breaking commit subjects', () => {
    const violations = validateConventionalCommitSubjects([
      {
        body: 'BREAKING CHANGE: extension manifests now require an id.',
        changedPaths: ['packages/extension-sdk/src/manifest.ts'],
        hash: 'a1b2c3d4',
        parentHashes: ['parent'],
        subject: 'feat(extension-sdk)!: require extension ids',
      },
      {
        body: '',
        changedPaths: ['.github/workflows/ci.yml'],
        hash: 'e5f6a7b8',
        parentHashes: ['parent'],
        subject: 'ci(release): dispatch validation for release pull requests',
      },
      {
        body: '',
        changedPaths: ['packages/extension-sdk/src/manifest.ts'],
        hash: 'c9d0e1f2',
        parentHashes: ['parent'],
        subject: 'revert(extension-sdk): restore optional extension ids',
      },
    ])

    expect(violations).toEqual([])
  })

  it('reports invalid authored subjects with the commit hash', () => {
    const violations = validateConventionalCommitSubjects([
      {
        body: '',
        changedPaths: ['scripts/check-conventional-commits.ts'],
        hash: 'a1b2c3d4',
        parentHashes: ['parent'],
        subject: 'Implement commit validation',
      },
    ])

    expect(violations).toEqual([
      'a1b2c3d4: "Implement commit validation" is not an allowed Conventional Commit subject.',
    ])
  })

  it('only exempts generated merge subjects that do not affect publishable packages', () => {
    const violations = validateConventionalCommitSubjects([
      {
        body: '',
        changedPaths: ['src/main/index.ts'],
        hash: 'a1b2c3d4',
        parentHashes: ['first-parent', 'second-parent'],
        subject: 'Merge pull request #123 from OpenWaggle/release-please--branches--main',
      },
      {
        body: 'This reverts commit 0123456789012345678901234567890123456789.',
        changedPaths: ['src/main/index.ts'],
        hash: 'e5f6a7b8',
        parentHashes: ['parent'],
        subject: 'Revert "feat(extension-sdk): publish extension manifests"',
      },
      {
        body: '',
        changedPaths: ['packages/extension-sdk/src/manifest.ts'],
        hash: 'c9d0e1f2',
        parentHashes: ['first-parent', 'second-parent'],
        subject: 'Merge pull request #124 from OpenWaggle/package-change',
      },
    ])

    expect(violations).toEqual([
      'e5f6a7b8: "Revert \\"feat(extension-sdk): publish extension manifests\\"" is not an allowed Conventional Commit subject.',
      'c9d0e1f2: "Merge pull request #124 from OpenWaggle/package-change" affects a publishable package and must carry explicit Conventional Commit release intent.',
    ])
  })

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
      await fs.rm(cwd, { force: true, recursive: true })
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
      await fs.rm(cwd, { force: true, recursive: true })
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
      await fs.rm(cwd, { force: true, recursive: true })
    }
  })

  it('derives the activation marker from squash-style current history instead of an abandoned SHA', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-commit-policy-'))
    try {
      await git(cwd, ['init'])
      const historicalCommit = await commit(cwd, 'historical commit without a Conventional Commit subject')
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
      await fs.rm(cwd, { force: true, recursive: true })
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
      await fs.rm(cwd, { force: true, recursive: true })
    }
  })

})
