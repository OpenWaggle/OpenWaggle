import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateConventionalCommits } from '../check-conventional-commits'
import { checkPackageReleaseLines } from '../package-release-lines'
import {
  conventionalCommitBump,
  nextReleaseVersion,
  packageReleaseLineViolations,
  type PackageReleaseLineState,
  type ReleaseCommit,
  type VersioningRules,
} from '../package-release-version'
import { createRepository as createPolicyRepository, git, writeAndCommit } from './commit-policy.test-harness'

const repositories: string[] = []

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((cwd) => fs.rm(cwd, { force: true, recursive: true })))
})

async function createRepository() {
  const repository = await createPolicyRepository()
  repositories.push(repository.cwd)
  return repository
}

const RULES: VersioningRules = { bumpMinorPreMajor: true, bumpPatchForMinorPreMajor: false }

function commit(subject: string, body = ''): ReleaseCommit {
  return { hash: `${subject.length.toString(16).padStart(9, '0')}abc`, subject, body }
}

function packageState(overrides: Partial<PackageReleaseLineState>): PackageReleaseLineState {
  return {
    component: 'waggle-core',
    slug: 'waggle-core',
    releasedVersion: '0.1.1',
    commits: [],
    publishedLines: ['0.1'],
    hasPendingDocs: false,
    ...overrides,
  }
}

describe('Release Please version prediction', () => {
  it('reads the bump each Conventional Commit asks for', () => {
    expect(conventionalCommitBump(commit('feat(platform): upgrade'))).toBe('minor')
    expect(conventionalCommitBump(commit('fix: repair'))).toBe('patch')
    expect(conventionalCommitBump(commit('perf(core): faster'))).toBe('patch')
    expect(conventionalCommitBump(commit('revert(core): undo'))).toBe('patch')
    expect(conventionalCommitBump(commit('feat(tokens)!: adopt contract'))).toBe('major')
    expect(conventionalCommitBump(commit('fix: x', 'BREAKING CHANGE: hosts must change.'))).toBe('major')
    expect(conventionalCommitBump(commit('fix: x', 'BREAKING-CHANGE: hosts must change.'))).toBe('major')
    expect(conventionalCommitBump(commit('chore(main): release OpenWaggle packages'))).toBe('none')
    expect(conventionalCommitBump(commit('docs: explain'))).toBe('none')
    expect(conventionalCommitBump(commit('Merge branch main'))).toBe('none')
  })

  it('bumps the minor version for features and breaking changes before 1.0.0', () => {
    const next = (subjects: readonly string[], releasedVersion = '0.1.1') =>
      nextReleaseVersion({ releasedVersion, commits: subjects.map((subject) => commit(subject)), rules: RULES })
    expect(next(['feat: a'])).toBe('0.2.0')
    expect(next(['feat!: a'])).toBe('0.2.0')
    expect(next(['fix: a', 'chore: b'])).toBe('0.1.2')
    expect(next(['docs: a', 'chore: b'])).toBeUndefined()
    expect(next([])).toBeUndefined()
  })

  it('bumps the major version for breaking changes from 1.0.0 on', () => {
    const next = (subjects: readonly string[]) =>
      nextReleaseVersion({ releasedVersion: '1.4.2', commits: subjects.map((subject) => commit(subject)), rules: RULES })
    expect(next(['feat!: a'])).toBe('2.0.0')
    expect(next(['feat: a'])).toBe('1.5.0')
    expect(next(['fix: a'])).toBe('1.4.3')
  })

  it('follows the pre-major options it is given', () => {
    const rules = { bumpMinorPreMajor: false, bumpPatchForMinorPreMajor: true }
    expect(nextReleaseVersion({ releasedVersion: '0.1.1', commits: [commit('feat!: a')], rules })).toBe('1.0.0')
    expect(nextReleaseVersion({ releasedVersion: '0.1.1', commits: [commit('feat: a')], rules })).toBe('0.1.2')
  })

  it('uses a Release-As footer, and the initial version for a package never released', () => {
    expect(
      nextReleaseVersion({ releasedVersion: '0.1.1', commits: [commit('fix: a', 'Release-As: 0.3.0')], rules: RULES }),
    ).toBe('0.3.0')
    expect(nextReleaseVersion({ releasedVersion: undefined, commits: [], rules: RULES, initialVersion: '0.1.0' })).toBe(
      '0.1.0',
    )
  })
})

describe('package documentation line violations', () => {
  it('asks for pending waggle-core 0.2 docs when a feature reached it after 0.1.1', () => {
    const violations = packageReleaseLineViolations(
      [packageState({ commits: [commit('feat(platform): upgrade to TypeScript 7 and Pi 0.81 (#144)')] })],
      RULES,
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('The next waggle-core release is 0.2.0')
    expect(violations[0]).toContain('feat(platform): upgrade to TypeScript 7 and Pi 0.81 (#144)')
    expect(violations[0]).toContain('website/src/content/package-docs-next/waggle-core/')
  })

  it('accepts pending docs, an already published line, or a release that stays on the line', () => {
    const feature = [commit('feat: a')]
    expect(packageReleaseLineViolations([packageState({ commits: feature, hasPendingDocs: true })], RULES)).toEqual([])
    expect(packageReleaseLineViolations([packageState({ commits: feature, publishedLines: ['0.1', '0.2'] })], RULES)).toEqual(
      [],
    )
    expect(packageReleaseLineViolations([packageState({ commits: [commit('fix: a')] })], RULES)).toEqual([])
  })

  it('names the pull request title when it is what opens the line', () => {
    const [violation] = packageReleaseLineViolations(
      [packageState({ commits: [{ hash: 'pull-request-title', subject: 'feat(core): add a helper', body: '' }] })],
      RULES,
    )
    expect(violation).toContain('because of the pull request title "feat(core): add a helper"')
  })
})

const CONFIG = {
  'bump-minor-pre-major': true,
  'initial-version': '0.1.0',
  packages: {
    'packages/waggle-core': { component: 'waggle-core' },
    'packages/pi-waggle': { component: 'pi-waggle' },
  },
}

async function createReleasedRepository() {
  const { baseline, cwd } = await createRepository()
  await writeAndCommit(cwd, 'release-please-config.json', JSON.stringify(CONFIG), 'ci: configure release please')
  await writeAndCommit(
    cwd,
    '.release-please-manifest.json',
    JSON.stringify({ 'packages/waggle-core': '0.1.1', 'packages/pi-waggle': '0.1.1' }),
    'ci: record package versions',
  )
  await writeAndCommit(cwd, 'website/src/content/docs/packages/waggle-core/0.1/index.md', 'guide\n', 'docs: core guide')
  await writeAndCommit(cwd, 'website/src/content/docs/packages/pi-waggle/0.1/index.md', 'guide\n', 'docs: pi guide')
  await writeAndCommit(cwd, 'packages/waggle-core/src/index.ts', 'export {}\n', 'fix(core): release 0.1.1')
  await git(cwd, ['tag', 'waggle-core-v0.1.0'])
  await git(cwd, ['tag', 'waggle-core-v0.1.1'])
  await git(cwd, ['tag', 'pi-waggle-v0.1.1'])
  return { baseline, cwd }
}

describe('package documentation lines from git history', () => {
  it('fails the exact main situation: waggle-core has a feature since waggle-core-v0.1.1 and no pending docs', async () => {
    const { cwd } = await createReleasedRepository()
    await writeAndCommit(cwd, 'packages/waggle-core/tsconfig.cjs.json', '{}\n', 'feat(platform): upgrade to TypeScript 7 (#144)')
    await writeAndCommit(cwd, 'packages/pi-waggle/src/index.ts', 'export {}\n', 'fix(pi-waggle): repair a turn')

    const result = await checkPackageReleaseLines({ cwd, to: 'HEAD', missingHistory: 'fail' })
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]).toContain('The next waggle-core release is 0.2.0')

    await writeAndCommit(
      cwd,
      'website/src/content/package-docs-next/waggle-core/index.md',
      'pending\n',
      'fix(packages): add pending waggle-core 0.2 docs',
    )
    expect((await checkPackageReleaseLines({ cwd, to: 'HEAD', missingHistory: 'fail' })).violations).toEqual([])
  })

  it('only counts commits that touch the package since its newest tag', async () => {
    const { cwd } = await createReleasedRepository()
    await writeAndCommit(cwd, 'src/app.ts', 'export {}\n', 'feat(app): an app feature')
    await writeAndCommit(cwd, 'packages/waggle-core/src/index.ts', 'export const a = 1\n', 'fix(core): a fix')
    await git(cwd, ['tag', 'waggle-core-v0.1.2'])
    await writeAndCommit(cwd, 'packages/waggle-core/src/index.ts', 'export const a = 2\n', 'fix(core): another fix')

    const result = await checkPackageReleaseLines({ cwd, to: 'HEAD', missingHistory: 'fail' })
    expect(result.violations).toEqual([])
    expect(result.packages.find((state) => state.component === 'waggle-core')).toMatchObject({
      releasedVersion: '0.1.2',
      commits: [expect.objectContaining({ subject: 'fix(core): another fix' })],
    })
  })

  it('counts the pull request title for each package the pull request touches', async () => {
    const { cwd } = await createReleasedRepository()
    const base = await git(cwd, ['rev-parse', 'HEAD'])
    await git(cwd, ['checkout', '-b', 'feature'])
    await writeAndCommit(cwd, 'packages/pi-waggle/src/index.ts', 'export const b = 1\n', 'fix(pi-waggle): wip')

    const withTitle = (prTitle: string) =>
      checkPackageReleaseLines({ base, cwd, missingHistory: 'fail', prTitle, to: 'HEAD' })
    expect((await withTitle('fix(pi-waggle): repair')).violations).toEqual([])
    const { violations } = await withTitle('feat(pi-waggle): add a command')
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('The next pi-waggle release is 0.2.0 because of the pull request title')
  })

  it('fails in CI and skips locally when a released package has no reachable tag', async () => {
    const { cwd } = await createReleasedRepository()
    await git(cwd, ['tag', '-d', 'pi-waggle-v0.1.1'])

    const failing = await checkPackageReleaseLines({ cwd, to: 'HEAD', missingHistory: 'fail' })
    expect(failing.violations).toEqual([
      expect.stringContaining('no pi-waggle-v* tag is reachable from HEAD, though .release-please-manifest.json records pi-waggle 0.1.1'),
    ])
    const skipping = await checkPackageReleaseLines({ cwd, to: 'HEAD', missingHistory: 'skip' })
    expect(skipping.violations).toEqual([])
    expect(skipping.skipped).toHaveLength(1)
  })

  it('does nothing in a repository without a Release Please config', async () => {
    const { cwd } = await createRepository()
    await fs.mkdir(path.join(cwd, 'packages', 'x'), { recursive: true })
    expect(await checkPackageReleaseLines({ cwd, to: 'HEAD', missingHistory: 'fail' })).toEqual({
      packages: [],
      skipped: [],
      violations: [],
    })
  })

  it('runs as part of the Conventional Commit policy', async () => {
    const { baseline, cwd } = await createReleasedRepository()
    await writeAndCommit(cwd, 'packages/waggle-core/src/index.ts', 'export const c = 1\n', 'feat(core): add a helper')

    const result = await validateConventionalCommits({ baseline, cwd, to: 'HEAD' })
    expect(result.violations).toEqual([expect.stringContaining('The next waggle-core release is 0.2.0')])
  })
})
