import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateConventionalCommits } from '../check-conventional-commits'
import { publishedLinesAt, releasedTagVersions } from '../package-release-git'
import { checkPackageReleaseLines } from '../package-release-lines'
import {
  createRepository as createPolicyRepository,
  git,
  writeAndCommit,
} from './commit-policy.test-harness'

const repositories: string[] = []

afterEach(async () => {
  await Promise.all(
    repositories.splice(0).map((cwd) => fs.rm(cwd, { force: true, recursive: true })),
  )
})

async function createRepository() {
  const repository = await createPolicyRepository()
  repositories.push(repository.cwd)
  return repository
}

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
  await writeAndCommit(
    cwd,
    'release-please-config.json',
    JSON.stringify(CONFIG),
    'ci: configure release please',
  )
  await writeAndCommit(
    cwd,
    '.release-please-manifest.json',
    JSON.stringify({ 'packages/waggle-core': '0.1.1', 'packages/pi-waggle': '0.1.1' }),
    'ci: record package versions',
  )
  await writeAndCommit(
    cwd,
    'website/src/content/docs/packages/waggle-core/0.1/index.md',
    'guide\n',
    'docs: core guide',
  )
  await writeAndCommit(
    cwd,
    'website/src/content/docs/packages/pi-waggle/0.1/index.md',
    'guide\n',
    'docs: pi guide',
  )
  await writeAndCommit(
    cwd,
    'packages/waggle-core/src/index.ts',
    'export {}\n',
    'fix(core): release 0.1.1',
  )
  await git(cwd, ['tag', 'waggle-core-v0.1.0'])
  await git(cwd, ['tag', 'waggle-core-v0.1.1'])
  await git(cwd, ['tag', 'pi-waggle-v0.1.1'])
  return { baseline, cwd }
}

describe('package documentation lines from git history', () => {
  it('fails the exact main situation: waggle-core has a feature since waggle-core-v0.1.1 and no pending docs', async () => {
    const { cwd } = await createReleasedRepository()
    await writeAndCommit(
      cwd,
      'packages/waggle-core/tsconfig.cjs.json',
      '{}\n',
      'feat(platform): upgrade to TypeScript 7 (#144)',
    )
    await writeAndCommit(
      cwd,
      'packages/pi-waggle/src/index.ts',
      'export {}\n',
      'fix(pi-waggle): repair a turn',
    )

    const result = await checkPackageReleaseLines({ cwd, to: 'HEAD', missingHistory: 'fail' })
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]).toContain('The next waggle-core release is 0.2.0')

    await writeAndCommit(
      cwd,
      'website/src/content/package-docs-next/waggle-core/index.md',
      'pending\n',
      'fix(packages): add pending waggle-core 0.2 docs',
    )
    expect(
      (await checkPackageReleaseLines({ cwd, to: 'HEAD', missingHistory: 'fail' })).violations,
    ).toEqual([])
  })

  it('only counts commits that touch the package since its newest tag', async () => {
    const { cwd } = await createReleasedRepository()
    await writeAndCommit(cwd, 'src/app.ts', 'export {}\n', 'feat(app): an app feature')
    await writeAndCommit(
      cwd,
      'packages/waggle-core/src/index.ts',
      'export const a = 1\n',
      'fix(core): a fix',
    )
    await writeAndCommit(
      cwd,
      '.release-please-manifest.json',
      JSON.stringify({ 'packages/waggle-core': '0.1.2', 'packages/pi-waggle': '0.1.1' }),
      'chore(main): release OpenWaggle packages',
    )
    await git(cwd, ['tag', 'waggle-core-v0.1.2'])
    await writeAndCommit(
      cwd,
      'packages/waggle-core/src/index.ts',
      'export const a = 2\n',
      'fix(core): another fix',
    )

    const result = await checkPackageReleaseLines({ cwd, to: 'HEAD', missingHistory: 'fail' })
    expect(result.violations).toEqual([])
    expect(result.packages.find((state) => state.component === 'waggle-core')).toMatchObject({
      releasedVersion: '0.1.2',
      commits: [expect.objectContaining({ message: 'fix(core): another fix' })],
    })
  })

  it('counts the pull request title for each package the pull request touches', async () => {
    const { cwd } = await createReleasedRepository()
    const base = await git(cwd, ['rev-parse', 'HEAD'])
    await git(cwd, ['checkout', '-b', 'feature'])
    await writeAndCommit(
      cwd,
      'packages/pi-waggle/src/index.ts',
      'export const b = 1\n',
      'fix(pi-waggle): wip',
    )

    const withTitle = (prTitle: string) =>
      checkPackageReleaseLines({ base, cwd, missingHistory: 'fail', prTitle, to: 'HEAD' })
    expect((await withTitle('fix(pi-waggle): repair')).violations).toEqual([])
    const { violations } = await withTitle('feat(pi-waggle): add a command')
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain(
      'The next pi-waggle release is 0.2.0 because of the pull request title',
    )
  })

  it('fails in CI and skips locally when a released package has no reachable tag', async () => {
    const { cwd } = await createReleasedRepository()
    await git(cwd, ['tag', '-d', 'pi-waggle-v0.1.1'])

    const failing = await checkPackageReleaseLines({ cwd, to: 'HEAD', missingHistory: 'fail' })
    expect(failing.violations).toEqual([
      expect.stringContaining(
        'no pi-waggle-v* tag is reachable from HEAD, though .release-please-manifest.json records pi-waggle 0.1.1',
      ),
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

  it('fails closed when the Release Please config cannot be read', async () => {
    const { cwd } = await createRepository()
    await writeAndCommit(cwd, 'release-please-config.json', '{ not json', 'ci: break the config')
    expect(
      (await checkPackageReleaseLines({ cwd, to: 'HEAD', missingHistory: 'fail' })).violations,
    ).toEqual([
      'Cannot predict package documentation lines: release-please-config.json is not valid JSON with a packages object.',
    ])
  })

  it('fails closed when a package entry is not an object', async () => {
    const { cwd } = await createReleasedRepository()
    await writeAndCommit(
      cwd,
      'release-please-config.json',
      JSON.stringify({ ...CONFIG, packages: { ...CONFIG.packages, 'packages/broken': 'yes' } }),
      'ci: add a broken package entry',
    )
    const { violations } = await checkPackageReleaseLines({
      cwd,
      to: 'HEAD',
      missingHistory: 'fail',
    })
    expect(violations).toContain(
      'Cannot predict package documentation lines: the release-please-config.json entry for packages/broken is not an object.',
    )
  })

  it('runs as part of the Conventional Commit policy', async () => {
    const { baseline, cwd } = await createReleasedRepository()
    await writeAndCommit(
      cwd,
      'packages/waggle-core/src/index.ts',
      'export const c = 1\n',
      'feat(core): add a helper',
    )

    const result = await validateConventionalCommits({ baseline, cwd, to: 'HEAD' })
    expect(result.violations).toEqual([
      expect.stringContaining('The next waggle-core release is 0.2.0'),
    ])
  })

  it('reads full commit messages, so a feat paragraph in a body counts', async () => {
    const { cwd } = await createReleasedRepository()
    await writeAndCommit(
      cwd,
      'packages/waggle-core/src/index.ts',
      'export const d = 1\n',
      'refactor(core): streamline the loop\n\nfeat(core): add a stop reason',
    )
    const { violations } = await checkPackageReleaseLines({
      cwd,
      to: 'HEAD',
      missingHistory: 'fail',
    })
    expect(violations).toEqual([expect.stringContaining('The next waggle-core release is 0.2.0')])
  })

  it('applies release-as from the package config', async () => {
    const { cwd } = await createReleasedRepository()
    const packages = {
      ...CONFIG.packages,
      'packages/pi-waggle': { component: 'pi-waggle', 'release-as': '1.0.0' },
    }
    await writeAndCommit(
      cwd,
      'release-please-config.json',
      JSON.stringify({ ...CONFIG, packages }),
      'ci: cut pi-waggle 1.0',
    )
    await writeAndCommit(
      cwd,
      'packages/pi-waggle/src/index.ts',
      'export const e = 1\n',
      'fix(pi-waggle): repair',
    )
    const { violations } = await checkPackageReleaseLines({
      cwd,
      to: 'HEAD',
      missingHistory: 'fail',
    })
    expect(violations).toEqual([
      expect.stringContaining('The next pi-waggle release is 1.0.0 because release-as is 1.0.0'),
    ])
  })

  it('fails closed on a versioning strategy it cannot reproduce, even locally', async () => {
    const { cwd } = await createReleasedRepository()
    await writeAndCommit(
      cwd,
      'release-please-config.json',
      JSON.stringify({ ...CONFIG, versioning: 'always-bump-minor' }),
      'ci: always bump minor',
    )
    const { violations } = await checkPackageReleaseLines({
      cwd,
      to: 'HEAD',
      missingHistory: 'skip',
    })
    expect(violations).toEqual([
      expect.stringContaining(
        'release-please-config.json gives packages/waggle-core versioning "always-bump-minor"',
      ),
      expect.stringContaining(
        'release-please-config.json gives packages/pi-waggle versioning "always-bump-minor"',
      ),
    ])
  })

  it('uses the manifest version when the release merged but its tags do not exist yet', async () => {
    const { cwd } = await createReleasedRepository()
    await writeAndCommit(
      cwd,
      'packages/waggle-core/src/index.ts',
      'export const f = 1\n',
      'feat(core): reach 0.2',
    )
    await writeAndCommit(
      cwd,
      'website/src/content/docs/packages/waggle-core/0.2/index.md',
      'guide\n',
      'docs: core 0.2 guide',
    )
    await writeAndCommit(
      cwd,
      '.release-please-manifest.json',
      JSON.stringify({ 'packages/waggle-core': '0.2.0', 'packages/pi-waggle': '0.1.1' }),
      'chore(main): release OpenWaggle packages',
    )
    expect(
      (await checkPackageReleaseLines({ cwd, to: 'HEAD', missingHistory: 'fail' })).violations,
    ).toEqual([])

    await writeAndCommit(
      cwd,
      'packages/waggle-core/src/index.ts',
      'export const f = 2\n',
      'feat(core): add a thing',
    )
    const result = await checkPackageReleaseLines({ cwd, to: 'HEAD', missingHistory: 'fail' })
    expect(result.packages.find((state) => state.component === 'waggle-core')).toMatchObject({
      releasedVersion: '0.2.0',
      commits: [expect.objectContaining({ message: 'feat(core): add a thing' })],
    })
    expect(result.violations).toEqual([
      expect.stringContaining('The next waggle-core release is 0.3.0'),
    ])

    await git(cwd, ['tag', 'waggle-core-v0.2.0', 'HEAD~1'])
    expect(
      (await checkPackageReleaseLines({ cwd, to: 'HEAD', missingHistory: 'fail' })).violations,
    ).toEqual([expect.stringContaining('The next waggle-core release is 0.3.0')])
  })

  it('orders tags by semver and docs lines by number', async () => {
    const { cwd } = await createReleasedRepository()
    for (const tag of [
      'waggle-core-v0.1.2-alpha.9',
      'waggle-core-v0.1.2-alpha.10',
      'waggle-core-v0.1.2',
    ]) {
      await git(cwd, ['tag', tag])
    }
    expect((await releasedTagVersions(cwd, 'waggle-core', 'HEAD')).map(String)).toEqual([
      '0.1.0',
      '0.1.1',
      '0.1.2-alpha.9',
      '0.1.2-alpha.10',
      '0.1.2',
    ])
    for (const line of ['0.10', '0.9', '0.2']) {
      await writeAndCommit(
        cwd,
        `website/src/content/docs/packages/pi-waggle/${line}/index.md`,
        'guide\n',
        `docs: pi ${line}`,
      )
    }
    await expect(
      publishedLinesAt(cwd, 'HEAD', 'website/src/content/docs/packages/pi-waggle'),
    ).resolves.toEqual(['0.1', '0.2', '0.9', '0.10'])
  })
})
