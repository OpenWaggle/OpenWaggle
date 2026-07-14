import { describe, expect, it } from 'vitest'
import { runPackageReleaseBootstrap, type BootstrapCommandResult } from '../package-release-bootstrap'
import {
  compatibleTrustConfiguration,
  createDependencies,
  PACKAGE_NAMES,
  publicAccess,
  successful,
} from './package-release-bootstrap-test-helpers'

describe('package release namespace bootstrap conflicts', () => {
  it('accepts npm automatic latest assignment as bootstrap state', async () => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = new Map<string, BootstrapCommandResult>([
      [`npm view ${packageName} --json`, successful(JSON.stringify({ name: packageName }))],
      [
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
      ],
      [
        `npm view ${packageName} dist-tags --json`,
        successful(
          JSON.stringify({
            bootstrap: '0.0.0-bootstrap.0',
            latest: '0.0.0-bootstrap.0',
          }),
        ),
      ],
      [`npm access get status ${packageName} --json`, publicAccess(packageName)],
      [
        `npm trust list ${packageName} --json`,
        successful(
          JSON.stringify(compatibleTrustConfiguration()),
        ),
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: [], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(true)
    expect(result.packages[0]).toEqual({
      name: packageName,
      nextAction: 'reassert unverifiable package MFA setting',
      state: 'pending',
    })
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it.each([
    ['latest targets another version', { bootstrap: '0.0.0-bootstrap.0', latest: '9.9.9' }],
    ['latest is malformed', { bootstrap: '0.0.0-bootstrap.0', latest: null }],
    ['an unrelated tag is present', { bootstrap: '0.0.0-bootstrap.0', next: '9.9.9' }],
  ])('refuses bootstrap state when %s', async (_caseName, tags) => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = new Map<string, BootstrapCommandResult>([
      [`npm view ${packageName} --json`, successful(JSON.stringify({ name: packageName }))],
      [
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
      ],
      [`npm view ${packageName} dist-tags --json`, successful(JSON.stringify(tags))],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(result.packages[0]).toEqual({
      name: packageName,
      nextAction: 'resolve conflicting bootstrap dist-tags',
      state: 'conflict',
    })
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('refuses an occupied package name with an additional published version', async () => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = new Map<string, BootstrapCommandResult>([
      [`npm view ${packageName} --json`, successful(JSON.stringify({ name: packageName }))],
      [
        `npm view ${packageName} versions --json`,
        successful(JSON.stringify(['0.0.0-bootstrap.0', '9.9.9'])),
      ],
      [
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
      ],
      [
        `npm view ${packageName} dist-tags --json`,
        successful(
          JSON.stringify({
            bootstrap: '0.0.0-bootstrap.0',
            latest: '0.0.0-bootstrap.0',
          }),
        ),
      ],
      [`npm access get status ${packageName} --json`, publicAccess(packageName)],
      [
        `npm trust list ${packageName} --json`,
        successful(JSON.stringify(compatibleTrustConfiguration())),
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(result.packages[0]).toEqual({
      name: packageName,
      nextAction: 'refuse occupied package name with non-bootstrap versions',
      state: 'conflict',
    })
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('refuses unexpected deprecation metadata with automatic latest', async () => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = new Map<string, BootstrapCommandResult>([
      [`npm view ${packageName} --json`, successful(JSON.stringify({ name: packageName }))],
      [
        `npm view ${packageName}@0.0.0-bootstrap.0 --json`,
        successful(
          JSON.stringify({
            deprecated: 'unexpected',
            files: [],
            name: packageName,
            openwaggleNamespaceBootstrap: true,
            version: '0.0.0-bootstrap.0',
          }),
        ),
      ],
      [
        `npm view ${packageName} dist-tags --json`,
        successful(
          JSON.stringify({
            bootstrap: '0.0.0-bootstrap.0',
            latest: '0.0.0-bootstrap.0',
          }),
        ),
      ],
      [`npm access get status ${packageName} --json`, publicAccess(packageName)],
      [`npm trust list ${packageName} --json`, successful()],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: [], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.packages[0]).toEqual({
      name: packageName,
      nextAction: 'resolve conflicting bootstrap deprecation metadata',
      state: 'conflict',
    })
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('refuses any non-bootstrap tag assigned to the bootstrap version before mutation', async () => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = new Map<string, BootstrapCommandResult>([
      [`npm view ${packageName} --json`, successful(JSON.stringify({ name: packageName }))],
      [
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
      ],
      [
        `npm view ${packageName} dist-tags --json`,
        successful(
          JSON.stringify({
            bootstrap: '0.0.0-bootstrap.0',
            next: '0.0.0-bootstrap.0',
          }),
        ),
      ],
      [`npm access get status ${packageName} --json`, publicAccess(packageName)],
      [`npm trust list ${packageName} --json`, successful()],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(result.packages[0]).toEqual({
      name: packageName,
      nextAction: 'resolve conflicting bootstrap dist-tags',
      state: 'conflict',
    })
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('refuses a bootstrap-marked package that exposes runtime entry points', async () => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = new Map<string, BootstrapCommandResult>([
      [`npm view ${packageName} --json`, successful(JSON.stringify({ name: packageName }))],
      [
        `npm view ${packageName}@0.0.0-bootstrap.0 --json`,
        successful(
          JSON.stringify({
            exports: './index.js',
            name: packageName,
            openwaggleNamespaceBootstrap: true,
            version: '0.0.0-bootstrap.0',
          }),
        ),
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(result.packages[0]).toEqual({
      name: packageName,
      nextAction: 'resolve conflicting bootstrap package metadata',
      state: 'conflict',
    })
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('refuses a bootstrap-marked package that includes runtime files', async () => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = new Map<string, BootstrapCommandResult>([
      [`npm view ${packageName} --json`, successful(JSON.stringify({ name: packageName }))],
      [
        `npm view ${packageName}@0.0.0-bootstrap.0 --json`,
        successful(
          JSON.stringify({
            files: ['index.js'],
            name: packageName,
            openwaggleNamespaceBootstrap: true,
            version: '0.0.0-bootstrap.0',
          }),
        ),
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: ['--execute'], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.packages[0]).toEqual({
      name: packageName,
      nextAction: 'resolve conflicting bootstrap package metadata',
      state: 'conflict',
    })
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

})
