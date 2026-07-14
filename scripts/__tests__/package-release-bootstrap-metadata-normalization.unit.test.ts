import { describe, expect, it } from 'vitest'
import { runPackageReleaseBootstrap, type BootstrapCommandResult } from '../package-release-bootstrap'
import {
  createDependencies,
  PACKAGE_NAMES,
  publicAccess,
  successful,
} from './package-release-bootstrap-test-helpers'

function metadataState(metadata: object, extraCommands: readonly BootstrapCommandResult[] = []) {
  const packageName = PACKAGE_NAMES[0]
  const overrides = new Map<string, BootstrapCommandResult>([
    [`npm view ${packageName} --json`, successful(JSON.stringify({ name: packageName }))],
    [
      `npm view ${packageName}@0.0.0-bootstrap.0 --json`,
      successful(
        JSON.stringify({
          name: packageName,
          openwaggleNamespaceBootstrap: true,
          version: '0.0.0-bootstrap.0',
          ...metadata,
        }),
      ),
    ],
  ])
  if (extraCommands.length > 0) {
    overrides.set(
      `npm view ${packageName} dist-tags --json`,
      extraCommands[0] ?? successful(),
    )
    overrides.set(
      `npm access get status ${packageName} --json`,
      extraCommands[1] ?? successful(),
    )
    overrides.set(`npm trust list ${packageName} --json`, extraCommands[2] ?? successful())
  }
  return createDependencies(overrides)
}

describe('package release bootstrap npm metadata normalization', () => {
  it('accepts an injected empty directories object for a one-file placeholder', async () => {
    const packageName = PACKAGE_NAMES[0]
    const { dependencies } = metadataState(
      { directories: {}, dist: { fileCount: 1 } },
      [
        successful(JSON.stringify({ bootstrap: '0.0.0-bootstrap.0' })),
        publicAccess(packageName),
        successful(),
      ],
    )

    const result = await runPackageReleaseBootstrap(
      { args: [], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.ok).toBe(true)
    expect(result.packages[0]?.state).toBe('pending')
  })

  it('refuses npm metadata that declares a runtime directory', async () => {
    const { dependencies, requests } = metadataState({
      directories: { lib: 'dist' },
      dist: { fileCount: 1 },
    })

    const result = await runPackageReleaseBootstrap(
      { args: [], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.packages[0]?.state).toBe('conflict')
    expect(requests.filter((request) => request.mutates)).toEqual([])
  })

  it('refuses contradictory normalized file-count evidence', async () => {
    const { dependencies } = metadataState({ dist: { fileCount: 2 }, files: [] })

    const result = await runPackageReleaseBootstrap(
      { args: [], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.packages[0]?.state).toBe('conflict')
  })

  it.each(['unexpected', {}])('refuses malformed normalized dist evidence: %j', async (dist) => {
    const { dependencies } = metadataState({ dist, files: [] })

    const result = await runPackageReleaseBootstrap(
      { args: [], projectRoot: '/workspace/OpenWaggle' },
      dependencies,
    )

    expect(result.packages[0]?.state).toBe('conflict')
  })
})
