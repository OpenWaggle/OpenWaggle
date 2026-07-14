import { describe, expect, it } from 'vitest'
import { runPackageReleaseBootstrap, type BootstrapCommandResult } from '../package-release-bootstrap'
import {
  addCompatibleGithubState,
  addCompatiblePackageState,
  commandKey,
  createDependencies,
  PACKAGE_NAMES,
  successful,
} from './package-release-bootstrap-test-helpers'

describe('package release namespace bootstrap tag repair', () => {
  it('repairs automatic latest after MFA without recreating compatible trust', async () => {
    const overrides = new Map<string, BootstrapCommandResult>([
      ['pnpm check', successful()],
      [
        'npm access list packages maintainer --json',
        successful(
          JSON.stringify(Object.fromEntries(PACKAGE_NAMES.map((name) => [name, 'read-write']))),
        ),
      ],
    ])
    addCompatiblePackageState(overrides)
    addCompatibleGithubState(overrides)
    for (const packageName of PACKAGE_NAMES) {
      overrides.set(`npm access set mfa=publish ${packageName}`, successful())
    }
    const firstPackage = PACKAGE_NAMES[0]
    overrides.set(`npm dist-tag rm ${firstPackage} latest`, successful())
    const automaticLatest = successful(
      JSON.stringify({
        bootstrap: '0.0.0-bootstrap.0',
        latest: '0.0.0-bootstrap.0',
      }),
    )
    const bootstrapOnly = successful(JSON.stringify({ bootstrap: '0.0.0-bootstrap.0' }))
    const sequenceOverrides = new Map<string, BootstrapCommandResult[]>([
      [
        `npm view ${firstPackage} dist-tags --json`,
        [automaticLatest, automaticLatest, automaticLatest, bootstrapOnly, bootstrapOnly],
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides, sequenceOverrides)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.blockers).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.packages.every((item) => item.state === 'complete')).toBe(true)
    expect(requests.filter((request) => request.mutates).map(commandKey)).toEqual([
      `npm access set mfa=publish ${firstPackage}`,
      `npm dist-tag rm ${firstPackage} latest`,
      ...PACKAGE_NAMES.slice(1).map((name) => `npm access set mfa=publish ${name}`),
    ])
  })
})
