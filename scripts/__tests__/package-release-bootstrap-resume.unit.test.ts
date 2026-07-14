import { describe, expect, it } from 'vitest'
import { runPackageReleaseBootstrap, type BootstrapCommandResult } from '../package-release-bootstrap'
import {
  compatibleTrustConfiguration,
  compatibleRuleset,
  createDependencies,
  PACKAGE_NAMES,
  publicAccess,
  successful,
} from './package-release-bootstrap-test-helpers'

describe('package release namespace bootstrap resume behavior', () => {
  it('reports compatible metadata with package MFA still pending verification', async () => {
    const overrides = new Map<string, BootstrapCommandResult>([
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm',
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
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm/deployment-branch-policies?per_page=2',
        successful(JSON.stringify({ branch_policies: [{ name: 'main', type: 'branch' }] })),
      ],
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm/secrets?per_page=1',
        successful(JSON.stringify({ secrets: [], total_count: 0 })),
      ],
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/rulesets?includes_parents=false&per_page=100 --paginate --slurp',
        successful(
          JSON.stringify([
            [
              { id: 7, name: 'Unrelated policy' },
              { id: 42, name: 'OpenWaggle main protections' },
            ],
          ]),
        ),
      ],
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/rulesets/42',
        successful(JSON.stringify(compatibleRuleset())),
      ],
    ])
    for (const packageName of PACKAGE_NAMES) {
      overrides.set(`npm view ${packageName} --json`, successful(JSON.stringify({ name: packageName })))
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
        successful(JSON.stringify({ bootstrap: '0.0.0-bootstrap.0' })),
      )
      overrides.set(
        `npm access get status ${packageName} --json`,
        successful(JSON.stringify({ [packageName]: 'public' })),
      )
      overrides.set(
        `npm trust list ${packageName} --json`,
        successful(
          JSON.stringify({
            environment: 'npm',
            file: 'package-release.yml',
            permissions: ['createPackage'],
            repository: 'OpenWaggle/OpenWaggle',
            type: 'github',
          }),
        ),
      )
    }
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: [], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(true)
    expect(result.packages).toEqual(
      PACKAGE_NAMES.map((name) => ({
        name,
        nextAction: 'reassert unverifiable package MFA setting',
        state: 'pending',
      })),
    )
    expect(result.github).toEqual({ environment: 'compatible', ruleset: 'compatible' })
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('reports sanitized resume state and cleans temp files after a partial publish failure', async () => {
    const firstPackage = PACKAGE_NAMES[0]
    const overrides = new Map<string, BootstrapCommandResult>([
      ['pnpm check', successful()],
      [
        `npm trust github ${firstPackage} --file package-release.yml --repository OpenWaggle/OpenWaggle --environment npm --allow-publish --yes`,
        successful(),
      ],
      [`npm access set mfa=publish ${firstPackage}`, successful()],
      [
        `npm deprecate ${firstPackage}@0.0.0-bootstrap.0 Namespace bootstrap placeholder; use a released version.`,
        successful(),
      ],
      [
        `npm trust list ${firstPackage} --json`,
        successful(JSON.stringify(compatibleTrustConfiguration())),
      ],
      [
        `npm view ${firstPackage}@0.0.0-bootstrap.0 --json`,
        successful(
          JSON.stringify({
            deprecated: 'Namespace bootstrap placeholder; use a released version.',
            files: [],
            name: firstPackage,
            openwaggleNamespaceBootstrap: true,
            version: '0.0.0-bootstrap.0',
          }),
        ),
      ],
      [
        `npm view ${firstPackage} dist-tags --json`,
        successful(JSON.stringify({ bootstrap: '0.0.0-bootstrap.0' })),
      ],
      [`npm access get status ${firstPackage} --json`, publicAccess(firstPackage)],
      [
        'npm access list packages maintainer --json',
        successful(JSON.stringify({ [firstPackage]: 'read-write' })),
      ],
    ])
    const publishSequence = new Map<string, BootstrapCommandResult[]>([
      [
        'npm publish --tag bootstrap --access public --ignore-scripts',
        [
          successful(),
          {
            exitCode: 1,
            stderr: 'npm error authorization failed for npm_secret_abcdefghijklmnopqrstuvwxyz',
            stdout: '',
          },
        ],
      ],
    ])
    const { dependencies, removedDirectories, requests } = createDependencies(
      overrides,
      publishSequence,
    )

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(result.blockers.join('\n')).not.toContain('npm_secret_abcdefghijklmnopqrstuvwxyz')
    expect(result.blockers.join('\n')).toContain('[redacted]')
    expect(result.packages[0]?.state).toBe('complete')
    expect(result.packages[1]?.nextAction).toBe('publish bootstrap placeholder')
    expect(result.nextAction).toBe(
      'Rerun pnpm package-release:bootstrap to inspect and resume partial state.',
    )
    expect(removedDirectories).toEqual([
      '/tmp/openwaggle-bootstrap-test',
      '/tmp/openwaggle-bootstrap-test',
    ])
    expect(requests.filter((request) => request.mutates).map((request) => [
      request.command,
      ...request.args,
    ].join(' '))).toEqual([
      'npm publish --tag bootstrap --access public --ignore-scripts',
      `npm access set mfa=publish ${firstPackage}`,
      `npm trust github ${firstPackage} --file package-release.yml --repository OpenWaggle/OpenWaggle --environment npm --allow-publish --yes`,
      `npm deprecate ${firstPackage}@0.0.0-bootstrap.0 Namespace bootstrap placeholder; use a released version.`,
      'npm publish --tag bootstrap --access public --ignore-scripts',
      `npm access set mfa=publish ${PACKAGE_NAMES[1]}`,
      `npm access set mfa=publish ${PACKAGE_NAMES[1]}`,
    ])
  })

  it('recognizes a safely resumable package record with trust still pending', async () => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = new Map<string, BootstrapCommandResult>([
      [`npm view ${packageName} --json`, successful(JSON.stringify({ name: packageName }))],
      [
        `npm view ${packageName}@0.0.0-bootstrap.0 --json`,
        successful(
          JSON.stringify({
            files: [],
            name: packageName,
            openwaggleNamespaceBootstrap: true,
            version: '0.0.0-bootstrap.0',
          }),
        ),
      ],
      [
        `npm view ${packageName} dist-tags --json`,
        successful(JSON.stringify({ bootstrap: '0.0.0-bootstrap.0' })),
      ],
      [`npm access get status ${packageName} --json`, publicAccess(packageName)],
      [`npm trust list ${packageName} --json`, successful()],
    ])
    const { dependencies } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: [], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(true)
    expect(result.packages[0]).toEqual({
      name: packageName,
      nextAction: 'configure trusted publisher and finalize bootstrap',
      state: 'pending',
    })
  })

  it('recognizes an interrupted environment creation with no branch policy as resumable', async () => {
    const overrides = new Map<string, BootstrapCommandResult>([
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm',
        successful(
          JSON.stringify({
            deployment_branch_policy: {
              custom_branch_policies: true,
              protected_branches: false,
            },
            protection_rules: [],
          }),
        ),
      ],
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm/deployment-branch-policies?per_page=2',
        successful(JSON.stringify({ branch_policies: [] })),
      ],
      [
        'gh api --hostname github.com repos/OpenWaggle/OpenWaggle/environments/npm/secrets?per_page=1',
        successful(JSON.stringify({ secrets: [], total_count: 0 })),
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: [], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(true)
    expect(result.github.environment).toBe('pending')
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('rejects token-bearing environments without accepting or printing token values', async () => {
    const { dependencies, requests } = createDependencies(
      new Map(),
      new Map(),
      {
        GH_TOKEN: 'github_secret_do_not_print',
        NODE_AUTH_TOKEN: 'node_auth_secret_do_not_print',
        NPM_CONFIG__AUTHTOKEN: 'configuration_token_do_not_print',
        NPM_CONFIG_OTP: '123456',
        NPM_TOKEN: 'npm_secret_do_not_print_this_value',
      },
    )

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(result.blockers).toContain(
      'NPM_TOKEN must be unset; bootstrap accepts authenticated CLI sessions only.',
    )
    expect(result.blockers).toContain(
      'NPM_CONFIG__AUTHTOKEN must be unset; bootstrap accepts authenticated CLI sessions only.',
    )
    expect(result.blockers).toContain(
      'NODE_AUTH_TOKEN must be unset; bootstrap accepts authenticated CLI sessions only.',
    )
    expect(result.blockers).toContain(
      'NPM_CONFIG_OTP must be unset; bootstrap accepts authenticated CLI sessions only.',
    )
    expect(result.blockers).toContain(
      'GH_TOKEN must be unset; bootstrap accepts authenticated CLI sessions only.',
    )
    expect(JSON.stringify(result)).not.toContain('npm_secret_do_not_print_this_value')
    expect(JSON.stringify(result)).not.toContain('configuration_token_do_not_print')
    expect(JSON.stringify(result)).not.toContain('node_auth_secret_do_not_print')
    expect(JSON.stringify(result)).not.toContain('github_secret_do_not_print')
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })
})
