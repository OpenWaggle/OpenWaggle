import { describe, expect, it } from 'vitest'
import { type PackageReleaseRules, packageReleaseRules } from '../package-release-rules'
import {
  nextReleaseVersion,
  packageReleaseLineViolations,
  type PackageReleaseLineState,
  type ReleaseCommit,
} from '../package-release-version'

const RULES: PackageReleaseRules = {
  bumpMinorPreMajor: true,
  bumpPatchForMinorPreMajor: false,
  releaseAs: undefined,
  initialVersion: '0.1.0',
  changelogSections: undefined,
}

let commitCounter = 0
function commit(subject: string, body = ''): ReleaseCommit {
  commitCounter += 1
  return {
    hash: commitCounter.toString(16).padStart(40, 'a'),
    message: body.length === 0 ? subject : `${subject}\n\n${body}`,
  }
}

function packageState(overrides: Partial<PackageReleaseLineState>): PackageReleaseLineState {
  return {
    component: 'waggle-core',
    slug: 'waggle-core',
    releasedVersion: '0.1.1',
    commits: [],
    rules: RULES,
    publishedLines: ['0.1'],
    hasPendingDocs: false,
    ...overrides,
  }
}

function next(
  messages: readonly ReleaseCommit[],
  releasedVersion: string | undefined,
  rules = RULES,
) {
  return nextReleaseVersion({ releasedVersion, commits: messages, rules, component: 'waggle-core' })
}

describe('Release Please version prediction with the pinned runtime', () => {
  it('bumps the minor version for features and breaking changes before 1.0.0', async () => {
    await expect(next([commit('feat: a')], '0.1.1')).resolves.toBe('0.2.0')
    await expect(next([commit('feature: a')], '0.1.1')).resolves.toBe('0.2.0')
    await expect(next([commit('feat!: a')], '0.1.1')).resolves.toBe('0.2.0')
    await expect(
      next([commit('fix: a', 'BREAKING CHANGE: hosts must change.')], '0.1.1'),
    ).resolves.toBe('0.2.0')
    await expect(
      next([commit('docs: a', 'BREAKING-CHANGE: hosts must change.')], '0.1.1'),
    ).resolves.toBe('0.2.0')
    await expect(next([commit('fix: a'), commit('chore: b')], '0.1.1')).resolves.toBe('0.1.2')
    await expect(next([commit('perf(core): faster')], '0.1.1')).resolves.toBe('0.1.2')
    await expect(next([commit('revert(core): undo')], '0.1.1')).resolves.toBe('0.1.2')
  })

  it('does not release for hidden types, non-conventional commits or no commits', async () => {
    await expect(
      next([commit('docs: a'), commit('chore(main): release OpenWaggle packages')], '0.1.1'),
    ).resolves.toBeUndefined()
    await expect(next([commit('Merge branch main')], '0.1.1')).resolves.toBeUndefined()
    await expect(next([], '0.1.1')).resolves.toBeUndefined()
  })

  it('reads a Conventional Commit paragraph in the body as its own commit, as Release Please does', async () => {
    await expect(
      next([commit('refactor: streamline the panel', 'feat: add a filter to the panel')], '0.1.1'),
    ).resolves.toBe('0.2.0')
    await expect(
      next(
        [
          commit(
            'chore: merge',
            'BEGIN_NESTED_COMMIT\nfeat(core): nested feature\nEND_NESTED_COMMIT',
          ),
        ],
        '0.1.1',
      ),
    ).resolves.toBe('0.2.0')
  })

  it('bumps the major version for breaking changes from 1.0.0 on', async () => {
    await expect(next([commit('feat!: a')], '1.4.2')).resolves.toBe('2.0.0')
    await expect(next([commit('feat: a')], '1.4.2')).resolves.toBe('1.5.0')
    await expect(next([commit('fix: a')], '1.4.2')).resolves.toBe('1.4.3')
  })

  it('follows the pre-major options it is given', async () => {
    const rules = { ...RULES, bumpMinorPreMajor: false, bumpPatchForMinorPreMajor: true }
    await expect(next([commit('feat!: a')], '0.1.1', rules)).resolves.toBe('1.0.0')
    await expect(next([commit('feat: a')], '0.1.1', rules)).resolves.toBe('0.1.2')
  })

  it('uses release-as config, then the newest Release-As footer, and the initial version for a new package', async () => {
    await expect(next([commit('fix: a', 'Release-As: 0.3.0')], '0.1.1')).resolves.toBe('0.3.0')
    await expect(
      next(
        [
          commit('chore: release 0.4.0', 'Release-As: 0.4.0'),
          commit('fix: a', 'Release-As: 0.3.0'),
        ],
        '0.1.1',
      ),
    ).resolves.toBe('0.4.0')
    await expect(
      next([commit('fix: a', 'Release-As: 0.3.0')], '0.1.1', { ...RULES, releaseAs: '1.0.0' }),
    ).resolves.toBe('1.0.0')
    await expect(next([commit('feat: first')], undefined)).resolves.toBe('0.1.0')
  })
})

describe('Release Please config rules', () => {
  const topLevel = {
    'release-type': 'node',
    'bump-minor-pre-major': true,
    'initial-version': '0.1.0',
  }

  it('lets a package setting override the top-level one', () => {
    expect(packageReleaseRules({}, topLevel)).toEqual({ ...RULES })
    expect(
      packageReleaseRules({ 'bump-minor-pre-major': false, 'release-as': '1.0.0' }, topLevel),
    ).toMatchObject({
      bumpMinorPreMajor: false,
      releaseAs: '1.0.0',
    })
    expect(packageReleaseRules({}, { ...topLevel, 'release-as': '' })).toMatchObject({
      releaseAs: undefined,
    })
  })

  it('defaults the initial version to 1.0.0 like Release Please', () => {
    expect(packageReleaseRules({}, {})).toMatchObject({
      initialVersion: '1.0.0',
      bumpMinorPreMajor: false,
    })
  })

  it('refuses settings it cannot reproduce instead of guessing', () => {
    expect(packageReleaseRules({ versioning: 'always-bump-minor' }, topLevel)).toContain(
      'versioning "always-bump-minor"',
    )
    expect(packageReleaseRules({}, { ...topLevel, 'release-type': 'python' })).toContain(
      'release-type "python"',
    )
    expect(packageReleaseRules({ 'changelog-type': 'github' }, topLevel)).toContain(
      'changelog-type "github"',
    )
    expect(packageReleaseRules({ 'exclude-paths': ['docs'] }, topLevel)).toContain('exclude-paths')
  })
})

describe('package documentation line violations', () => {
  it('asks for pending waggle-core 0.2 docs when a feature reached it after 0.1.1', async () => {
    const violations = await packageReleaseLineViolations([
      packageState({
        commits: [commit('feat(platform): upgrade to TypeScript 7 and Pi 0.81 (#144)')],
      }),
    ])
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('The next waggle-core release is 0.2.0')
    expect(violations[0]).toContain('feat(platform): upgrade to TypeScript 7 and Pi 0.81 (#144)')
    expect(violations[0]).toContain('website/src/content/package-docs-next/waggle-core/')
    expect(violations[0]).toContain('start from website/src/content/docs/packages/waggle-core/0.1/')
    expect(violations[0]).toContain(
      'or retitle or rebase it so the commit that opens the line does not land',
    )
    expect(violations[0]).toContain('Update your branch from main if main already has these docs.')
  })

  it('accepts pending docs, an already published line, or a release that stays on the line', async () => {
    const feature = [commit('feat: a')]
    await expect(
      packageReleaseLineViolations([packageState({ commits: feature, hasPendingDocs: true })]),
    ).resolves.toEqual([])
    await expect(
      packageReleaseLineViolations([
        packageState({ commits: feature, publishedLines: ['0.1', '0.2'] }),
      ]),
    ).resolves.toEqual([])
    await expect(
      packageReleaseLineViolations([packageState({ commits: [commit('fix: a')] })]),
    ).resolves.toEqual([])
  })

  it('names the pull request title when it is what opens the line', async () => {
    const [violation] = await packageReleaseLineViolations([
      packageState({
        commits: [{ hash: 'pull-request-title', message: 'feat(core): add a helper' }],
      }),
    ])
    expect(violation).toContain('because of the pull request title "feat(core): add a helper"')
  })

  it('names release-as config when it is what opens the line', async () => {
    const [violation] = await packageReleaseLineViolations([
      packageState({ commits: [commit('fix: a')], rules: { ...RULES, releaseAs: '1.0.0' } }),
    ])
    expect(violation).toContain('The next waggle-core release is 1.0.0 because release-as is 1.0.0')
  })
})
