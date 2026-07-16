import { describe, expect, it } from 'vitest'
import { runPackageReleaseBootstrap, type BootstrapCommandResult } from '../package-release-bootstrap'
import {
  commandKey,
  compatibleTrustConfiguration,
  compatibleRuleset,
  createDependencies,
  PACKAGE_NAMES,
  publicAccess,
  successful,
} from './package-release-bootstrap-test-helpers'

describe('package release namespace bootstrap execution', () => {
  it('revalidates namespace state after checks and before the first mutation', async () => {
    const packageName = PACKAGE_NAMES[0]
    const sequenceOverrides = new Map<string, BootstrapCommandResult[]>([
      [
        `npm view ${packageName} --json`,
        [
          { exitCode: 1, stderr: 'npm error code E404', stdout: '' },
          successful(JSON.stringify({ name: packageName })),
        ],
      ],
    ])
    const overrides = new Map<string, BootstrapCommandResult>([
      ['pnpm check', successful()],
      [
        `npm view ${packageName}@0.0.0-bootstrap.0 --json`,
        { exitCode: 1, stderr: 'npm error code E404', stdout: '' },
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides, sequenceOverrides)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(result.packages[0]).toEqual({
      name: packageName,
      nextAction: 'refuse occupied package name without 0.0.0-bootstrap.0',
      state: 'conflict',
    })
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('executes the complete bootstrap with npm automatic latest and no runtime code', async () => {
    const overrides = new Map<string, BootstrapCommandResult>([
      ['pnpm check', successful()],
      [
        'npm access list packages maintainer --json',
        successful(
          JSON.stringify(Object.fromEntries(PACKAGE_NAMES.map((name) => [name, 'read-write']))),
        ),
      ],
      [
        'gh api --hostname github.com --method PUT repos/OpenWaggle/OpenWaggle/environments/npm --input -',
        successful(),
      ],
      [
        'gh api --hostname github.com --method POST repos/OpenWaggle/OpenWaggle/environments/npm/deployment-branch-policies --input -',
        successful(),
      ],
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm/deployment-branch-policies?per_page=2',
        successful(JSON.stringify({ branch_policies: [{ name: 'main', type: 'branch' }] })),
      ],
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm/secrets?per_page=1',
        successful(JSON.stringify({ secrets: [], total_count: 0 })),
      ],
      [
        'gh api --hostname github.com --method POST repos/OpenWaggle/OpenWaggle/rulesets --input -',
        successful(JSON.stringify({ id: 42 })),
      ],
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/rulesets/42',
        successful(JSON.stringify(compatibleRuleset())),
      ],
    ])

    for (const packageName of PACKAGE_NAMES) {
      overrides.set(
        `npm publish --tag bootstrap --access public --ignore-scripts`,
        successful(),
      )
      overrides.set(
        `npm trust github ${packageName} --file package-release.yml --repository OpenWaggle/OpenWaggle --environment npm --allow-publish --yes`,
        successful(),
      )
      overrides.set(`npm access set mfa=publish ${packageName}`, successful())
      overrides.set(
        `npm deprecate ${packageName}@0.0.0-bootstrap.0 Namespace bootstrap placeholder; use a released version.`,
        successful(),
      )
      overrides.set(
        `npm trust list ${packageName} --json`,
        successful(JSON.stringify(compatibleTrustConfiguration())),
      )
      overrides.set(
        `npm view ${packageName}@0.0.0-bootstrap.0 --json`,
        successful(
          JSON.stringify({
            deprecated: 'Namespace bootstrap placeholder; use a released version.',
            files: [],
            name: packageName,
            openwaggleNamespaceBootstrap: true,
            version: '0.0.0-bootstrap.0',
          }),
        ),
      )
      overrides.set(
        `npm view ${packageName} dist-tags --json`,
        successful(
          JSON.stringify({
            bootstrap: '0.0.0-bootstrap.0',
            latest: '0.0.0-bootstrap.0',
          }),
        ),
      )
      overrides.set(`npm access get status ${packageName} --json`, publicAccess(packageName))
    }
    const environmentSequence = new Map<string, BootstrapCommandResult[]>([
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm',
        [
          { exitCode: 1, stderr: 'HTTP 404: Not Found', stdout: '' },
          { exitCode: 1, stderr: 'HTTP 404: Not Found', stdout: '' },
          successful(
            JSON.stringify({
              deployment_branch_policy: {
                custom_branch_policies: true,
                protected_branches: false,
              },
              protection_rules: [{ type: 'branch_policy' }],
            }),
          ),
        ],
      ],
    ])
    const { dependencies, requests, writtenFiles } = createDependencies(
      overrides,
      environmentSequence,
    )

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(true)
    expect(result.packages.every((item) => item.state === 'complete')).toBe(true)
    expect(result.github).toEqual({ environment: 'complete', ruleset: 'complete' })
    expect(result.nextAction).toBe('Merge the coordinated Release Please PR for the first 0.1.0 releases.')
    expect(writtenFiles).toHaveLength(4)
    for (const { contents, filePath } of writtenFiles) {
      expect(filePath).toBe('/tmp/openwaggle-bootstrap-test/package.json')
      const packageJson: unknown = JSON.parse(contents)
      expect(packageJson).toEqual({
        description: 'Namespace-only bootstrap placeholder. This package contains no runtime code.',
        files: [],
        license: 'UNLICENSED',
        name: expect.stringMatching(/^@openwaggle\//u),
        openwaggleNamespaceBootstrap: true,
        publishConfig: { access: 'public', tag: 'bootstrap' },
        version: '0.0.0-bootstrap.0',
      })
    }
    const mutatingRequests = requests.filter((request) => request.mutates)
    expect(mutatingRequests).toHaveLength(19)
    expect(
      mutatingRequests
        .filter((request) => request.command === 'npm')
        .every((request) => request.interactive === true),
    ).toBe(true)
    expect(
      mutatingRequests
        .filter((request) => request.command === 'gh')
        .every((request) => request.interactive !== true),
    ).toBe(true)
    expect(mutatingRequests.every((request) => !commandKey(request).includes('latest'))).toBe(true)
    expect(requests.every((request) => !commandKey(request).includes('release create'))).toBe(true)
    expect(requests.every((request) => !commandKey(request).startsWith('git tag'))).toBe(true)
    expect(
      requests.filter((request) => commandKey(request).startsWith('npm trust github')),
    ).toHaveLength(4)
    const rulesetRequest = requests.find(
      (request) =>
        commandKey(request) ===
        'gh api --hostname github.com --method POST repos/OpenWaggle/OpenWaggle/rulesets --input -',
    )
    const rulesetPayload: unknown = JSON.parse(rulesetRequest?.input ?? '')
    expect(rulesetPayload).toEqual(
      expect.objectContaining({
        rules: expect.arrayContaining([
          {
            parameters: expect.objectContaining({
              required_status_checks: [
                { context: 'Package Release Gate' },
                { context: 'Commit Policy' },
                { context: 'Typecheck & Lint' },
                { context: 'Unit & Component Tests' },
              ],
            }),
            type: 'required_status_checks',
          },
        ]),
      }),
    )
  })
})
