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
  it('classifies npm automatic latest assignment as a resumable repair', async () => {
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
      nextAction: 'remove automatic bootstrap latest tag, then reassert package MFA',
      state: 'pending',
    })
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('accepts npm-normalized metadata when the placeholder tarball contains one file', async () => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = new Map<string, BootstrapCommandResult>([
      [`npm view ${packageName} --json`, successful(JSON.stringify({ name: packageName }))],
      [
        `npm view ${packageName}@0.0.0-bootstrap.0 --json`,
        successful(
          JSON.stringify({
            dist: { fileCount: 1 },
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

  it('refuses contradictory normalized file-count evidence', async () => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = new Map<string, BootstrapCommandResult>([
      [`npm view ${packageName} --json`, successful(JSON.stringify({ name: packageName }))],
      [
        `npm view ${packageName}@0.0.0-bootstrap.0 --json`,
        successful(
          JSON.stringify({
            dist: { fileCount: 2 },
            files: [],
            name: packageName,
            openwaggleNamespaceBootstrap: true,
            version: '0.0.0-bootstrap.0',
          }),
        ),
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: [], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.packages[0]).toEqual({
      name: packageName,
      nextAction: 'resolve conflicting bootstrap package metadata',
      state: 'conflict',
    })
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it.each(['unexpected', {}])('refuses malformed normalized dist evidence: %j', async (dist) => {
    const packageName = PACKAGE_NAMES[0]
    const overrides = new Map<string, BootstrapCommandResult>([
      [`npm view ${packageName} --json`, successful(JSON.stringify({ name: packageName }))],
      [
        `npm view ${packageName}@0.0.0-bootstrap.0 --json`,
        successful(
          JSON.stringify({
            dist,
            files: [],
            name: packageName,
            openwaggleNamespaceBootstrap: true,
            version: '0.0.0-bootstrap.0',
          }),
        ),
      ],
    ])
    const { dependencies, requests } = createDependencies(overrides)

    const result = await runPackageReleaseBootstrap(
      { args: [], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.packages[0]?.state).toBe('conflict')
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('refuses unexpected deprecation metadata before repairing automatic latest', async () => {
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
