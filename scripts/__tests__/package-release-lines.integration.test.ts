import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkPackageReleaseLines } from '../package-release-lines'
import { git, writeAndCommit } from './commit-policy.test-harness'
import {
  CONFIG,
  createReleasedRepository,
  createRepository,
} from './package-release-lines.test-support'

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
})
