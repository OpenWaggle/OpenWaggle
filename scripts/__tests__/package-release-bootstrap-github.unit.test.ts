import { describe, expect, it } from 'vitest'
import { runPackageReleaseBootstrap, type BootstrapCommandResult } from '../package-release-bootstrap'
import { createAndVerifyRuleset } from '../package-release-bootstrap-github'
import {
  commandKey,
  compatibleRuleset,
  createDependencies,
  successful,
} from './package-release-bootstrap-test-helpers'

describe('package release namespace bootstrap GitHub policy', () => {
  it('reports repository merge-mode drift as pending without mutating during preflight', async () => {
    const overrides = new Map<string, BootstrapCommandResult>([
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle',
        successful(
          JSON.stringify({
            allow_merge_commit: true,
            allow_rebase_merge: true,
            allow_squash_merge: true,
            unrelated_setting: 'preserved',
          }),
        ),
      ],
      ...rulesetOverrides(compatibleRuleset()),
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: [], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.github.ruleset).toBe('pending')
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('sets exact merge modes without overwriting unrelated repository settings', async () => {
    const repositoryEndpoint = 'repos/OpenWaggle/OpenWaggle'
    const repositoryKey = `gh api --hostname github.com ${repositoryEndpoint}`
    const overrides = new Map<string, BootstrapCommandResult>([
      [
        repositoryKey,
        successful(
          JSON.stringify({
            allow_merge_commit: true,
            allow_rebase_merge: true,
            allow_squash_merge: true,
            unrelated_setting: 'preserved',
          }),
        ),
      ],
      [
        `gh api --hostname github.com --method PATCH ${repositoryEndpoint} --input -`,
        successful(),
      ],
      ...rulesetOverrides(compatibleRuleset()),
    ])
    const sequenceOverrides = new Map<string, BootstrapCommandResult[]>([
      [
        repositoryKey,
        [
          overrides.get(repositoryKey) ?? successful(),
          successful(
            JSON.stringify({
              allow_merge_commit: false,
              allow_rebase_merge: true,
              allow_squash_merge: true,
              unrelated_setting: 'preserved',
            }),
          ),
        ],
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides, sequenceOverrides)

    await createAndVerifyRuleset('/workspace/OpenWaggle', dependencies)

    const mutation = requests.find(
      (request) =>
        commandKey(request) ===
        `gh api --hostname github.com --method PATCH ${repositoryEndpoint} --input -`,
    )
    expect(mutation?.input).toBe(
      JSON.stringify({
        allow_merge_commit: false,
        allow_rebase_merge: true,
        allow_squash_merge: true,
      }),
    )
    expect(requests.map(commandKey)).not.toContain(
      'gh api --hostname github.com --method POST repos/OpenWaggle/OpenWaggle/rulesets --input -',
    )
  })

  it('fails closed when repository merge-mode verification still reports drift', async () => {
    const repositoryEndpoint = 'repos/OpenWaggle/OpenWaggle'
    const repositoryKey = `gh api --hostname github.com ${repositoryEndpoint}`
    const driftingSettings = successful(
      JSON.stringify({
        allow_merge_commit: true,
        allow_rebase_merge: true,
        allow_squash_merge: true,
      }),
    )
    const overrides = new Map<string, BootstrapCommandResult>([
      [repositoryKey, driftingSettings],
      [
        `gh api --hostname github.com --method PATCH ${repositoryEndpoint} --input -`,
        successful(),
      ],
      ...rulesetOverrides(compatibleRuleset()),
    ])
    const sequenceOverrides = new Map<string, BootstrapCommandResult[]>([
      [repositoryKey, [driftingSettings, driftingSettings]],
    ])
    const { dependencies, requests } = createDependencies(overrides, sequenceOverrides)

    await expect(
      createAndVerifyRuleset('/workspace/OpenWaggle', dependencies),
    ).rejects.toThrow('GitHub repository merge policy verification failed.')
    expect(requests.filter((request) => request.mutates)).toHaveLength(1)
  })

  it('fails closed when the npm environment contains reviewers or secrets', async () => {
    const overrides = new Map<string, BootstrapCommandResult>([
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm',
        successful(
          JSON.stringify({
            deployment_branch_policy: {
              custom_branch_policies: true,
              protected_branches: false,
            },
            protection_rules: [
              { reviewers: [{ type: 'User' }], type: 'required_reviewers' },
              { type: 'branch_policy' },
            ],
          }),
        ),
      ],
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm/deployment-branch-policies?per_page=2',
        successful(JSON.stringify({ branch_policies: [{ name: 'main', type: 'branch' }] })),
      ],
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm/secrets?per_page=1',
        successful(JSON.stringify({ secrets: [{ name: 'NPM_TOKEN' }], total_count: 1 })),
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(result.github.environment).toBe('conflict')
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('fails closed when the managed ruleset contains an extra rule', async () => {
    const ruleset = compatibleRuleset()
    ruleset.rules.push({ type: 'required_signatures' })
    const overrides = rulesetOverrides(ruleset)
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(result.github.ruleset).toBe('conflict')
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('fails closed when the managed ruleset contains an untyped extra rule', async () => {
    const ruleset = compatibleRuleset()
    ruleset.rules.push({})
    const { dependencies, requests } = createDependencies(rulesetOverrides(ruleset))

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.github.ruleset).toBe('conflict')
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('fails closed when required checks contain an untyped extra entry', async () => {
    const ruleset = compatibleRuleset([
      { context: 'Commit Policy' },
      { context: 'Typecheck & Lint' },
      { context: 'Unit & Component Tests' },
      {},
    ])
    const { dependencies, requests } = createDependencies(rulesetOverrides(ruleset))

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.github.ruleset).toBe('conflict')
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('rejects an inherited ruleset with the managed repository ruleset name', async () => {
    const ruleset = {
      ...compatibleRuleset(),
      source: 'OpenWaggle',
      source_type: 'Organization',
    }
    const { dependencies, requests } = createDependencies(rulesetOverrides(ruleset))

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.github.ruleset).toBe('conflict')
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('inspects every repository ruleset page through one valid JSON response', async () => {
    const overrides = new Map<string, BootstrapCommandResult>([
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/rulesets?includes_parents=false&per_page=100 --paginate --slurp',
        successful(
          JSON.stringify([
            [{ id: 7, name: 'Unrelated policy' }],
            [{ id: 42, name: 'OpenWaggle main protections' }],
          ]),
        ),
      ],
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/rulesets/42',
        successful(JSON.stringify(compatibleRuleset())),
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: [], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.github.ruleset).toBe('compatible')
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })
})

function rulesetOverrides(ruleset: unknown) {
  return new Map<string, BootstrapCommandResult>([
    [
      'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/rulesets?includes_parents=false&per_page=100 --paginate --slurp',
      successful(JSON.stringify([[{ id: 42, name: 'OpenWaggle main protections' }]])),
    ],
    [
      'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/rulesets/42',
      successful(JSON.stringify(ruleset)),
    ],
  ])
}
