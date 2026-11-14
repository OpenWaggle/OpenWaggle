import { describe, expect, it } from 'vitest'
import { validateConventionalCommits } from '../check-conventional-commits'
import { publishedLinesAt, releasedTagVersions } from '../package-release-git'
import { checkPackageReleaseLines } from '../package-release-lines'
import { git, writeAndCommit } from './commit-policy.test-harness'
import { CONFIG, createReleasedRepository } from './package-release-lines.test-support'

describe('package documentation lines from release configuration and tags', () => {
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
