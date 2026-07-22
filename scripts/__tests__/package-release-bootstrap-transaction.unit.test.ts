import { describe, expect, it } from 'vitest'
import { runPackageReleaseBootstrap, type BootstrapCommandResult } from '../package-release-bootstrap'
import {
  commandKey,
  compatibleTrustConfiguration,
  createDependencies,
  PACKAGE_NAMES,
  publicAccess,
  successful,
  successfulFirstPackageTransaction,
} from './package-release-bootstrap-test-helpers'

describe('package release namespace bootstrap package transaction', () => {
  it('secures and finalizes each new package before publishing the next package', async () => {
    const [firstPackage, secondPackage] = PACKAGE_NAMES
    const overrides = new Map<string, BootstrapCommandResult>([
      ['pnpm check', successful()],
      [
        'npm access list packages maintainer --json',
        successful(JSON.stringify({
          [firstPackage]: 'read-write',
          [secondPackage]: 'read-write',
        })),
      ],
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
        successful(JSON.stringify({
          deprecated: 'Namespace bootstrap placeholder; use a released version.',
          files: [],
          name: firstPackage,
          openwaggleNamespaceBootstrap: true,
          version: '0.0.0-bootstrap.0',
        })),
      ],
      [
        `npm view ${firstPackage} dist-tags --json`,
        successful(JSON.stringify({ bootstrap: '0.0.0-bootstrap.0' })),
      ],
      [`npm access get status ${firstPackage} --json`, publicAccess(firstPackage)],
    ])
    const publishSequence = new Map<string, BootstrapCommandResult[]>([
      [
        'npm publish --tag bootstrap --access public --ignore-scripts',
        [
          successful(),
          { exitCode: 1, stderr: 'second package publish failed', stdout: '' },
        ],
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides, publishSequence)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(requests.filter((request) => request.mutates).map(commandKey)).toEqual([
      'npm publish --tag bootstrap --access public --ignore-scripts',
      `npm access set mfa=publish ${firstPackage}`,
      `npm deprecate ${firstPackage}@0.0.0-bootstrap.0 Namespace bootstrap placeholder; use a released version.`,
      `npm trust github ${firstPackage} --file package-release.yml --repository OpenWaggle/OpenWaggle --environment npm --allow-publish --yes`,
      'npm publish --tag bootstrap --access public --ignore-scripts',
      `npm access set mfa=publish ${secondPackage}`,
      `npm access set mfa=publish ${secondPackage}`,
    ])
    expect(result.packages[0]?.state).toBe('complete')
    expect(result.packages[1]?.nextAction).toBe('publish bootstrap placeholder')
  })

  it('restricts publishing after an ambiguous placeholder publish failure', async () => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = successfulFirstPackageTransaction(packageName)
    overrides.set('npm publish --tag bootstrap --access public --ignore-scripts', {
      exitCode: 1,
      stderr: 'registry response was interrupted after upload',
      stdout: '',
    })
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(requests.filter((request) => request.mutates).map(commandKey)).toEqual([
      'npm publish --tag bootstrap --access public --ignore-scripts',
      `npm access set mfa=publish ${packageName}`,
      `npm access set mfa=publish ${packageName}`,
    ])
  })

  it('retries the restrictive policy when its first attempt fails', async () => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = successfulFirstPackageTransaction(packageName)
    const sequences = new Map<string, BootstrapCommandResult[]>([
      [
        `npm access set mfa=publish ${packageName}`,
        [
          { exitCode: 1, stderr: 'temporary MFA policy failure', stdout: '' },
          successful(),
        ],
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides, sequences)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(requests.filter((request) => request.mutates).map(commandKey)).toEqual([
      'npm publish --tag bootstrap --access public --ignore-scripts',
      `npm access set mfa=publish ${packageName}`,
      `npm access set mfa=publish ${packageName}`,
    ])
  })

  it.each([
    {
      failedCommand: 'trust',
      mutation: (packageName: string) =>
        `npm trust github ${packageName} --file package-release.yml --repository OpenWaggle/OpenWaggle --environment npm --allow-publish --yes`,
    },
    {
      failedCommand: 'deprecate',
      mutation: (packageName: string) =>
        `npm deprecate ${packageName}@0.0.0-bootstrap.0 Namespace bootstrap placeholder; use a released version.`,
    },
  ])('reasserts MFA and stops after a $failedCommand mutation failure', async ({ mutation }) => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = successfulFirstPackageTransaction(packageName)
    overrides.set(mutation(packageName), {
      exitCode: 1,
      stderr: 'injected mutation failure',
      stdout: '',
    })
    const sequences = new Map<string, BootstrapCommandResult[]>([
      [`npm access set mfa=publish ${packageName}`, [successful(), successful()]],
    ])
    const { dependencies, requests } = createDependencies(overrides, sequences)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(false)
    const mutations = requests.filter((request) => request.mutates).map(commandKey)
    expect(mutations.at(-1)).toBe(`npm access set mfa=publish ${packageName}`)
    expect(mutations.filter((command) => command.includes('npm publish'))).toHaveLength(1)
    expect(mutations.filter((command) => command.includes('mfa=publish'))).toHaveLength(2)
  })
})
