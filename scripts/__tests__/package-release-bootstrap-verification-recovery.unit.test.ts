import { describe, expect, it } from 'vitest'
import { runPackageReleaseBootstrap, type BootstrapCommandResult } from '../package-release-bootstrap'
import {
  commandKey,
  createDependencies,
  PACKAGE_NAMES,
  successful,
  successfulFirstPackageTransaction,
} from './package-release-bootstrap-test-helpers'

describe('package release bootstrap verification recovery', () => {
  it.each([
    (packageName: string) => `npm view ${packageName}@0.0.0-bootstrap.0 --json`,
    (packageName: string) => `npm view ${packageName} dist-tags --json`,
    (packageName: string) => `npm access get status ${packageName} --json`,
    () => 'npm access list packages maintainer --json',
    (packageName: string) => `npm trust list ${packageName} --json`,
  ])('reasserts MFA when verification read %s fails', async (failedCommand) => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = successfulFirstPackageTransaction(packageName)
    overrides.set(failedCommand(packageName), {
      exitCode: 1,
      stderr: 'injected verification failure',
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

  it('reasserts MFA when final post-deprecation verification fails', async () => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = successfulFirstPackageTransaction(packageName)
    const metadataCommand = `npm view ${packageName}@0.0.0-bootstrap.0 --json`
    const compatibleMetadata = overrides.get(metadataCommand) ?? successful()
    const sequences = new Map<string, BootstrapCommandResult[]>([
      [metadataCommand, [compatibleMetadata, {
        exitCode: 1,
        stderr: 'final verification failed',
        stdout: '',
      }]],
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
    expect(mutations).toContain(
      `npm deprecate ${packageName}@0.0.0-bootstrap.0 Namespace bootstrap placeholder; use a released version.`,
    )
  })
})
