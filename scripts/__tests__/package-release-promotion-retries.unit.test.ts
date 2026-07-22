import { describe, expect, it, vi } from 'vitest'

import { promoteVerifiedPackageRelease } from '../package-release-promotion'
import type {
  PackageReleaseArtifactManifest,
  PackageReleasePlan,
} from '../package-release-promotion'

const sdkPlan: PackageReleasePlan = {
  packages: [{
    key: 'extension-sdk',
    name: '@openwaggle/extension-sdk',
    packagePath: 'packages/extension-sdk',
    tag: 'extension-sdk-v0.1.1',
    version: '0.1.1',
  }],
  schemaVersion: 1,
  sourceSha: 'source-sha',
  sourceTree: 'source-tree',
}
const sdkManifest: PackageReleaseArtifactManifest = {
  packages: [{
    file: 'extension-sdk.tgz',
    integrity: 'sha512-sdk',
    key: 'extension-sdk',
    name: '@openwaggle/extension-sdk',
    releaseNotes: 'SDK notes',
    sha256: 'sdk',
    tag: 'extension-sdk-v0.1.1',
    version: '0.1.1',
  }],
  schemaVersion: 1,
  sourceSha: 'source-sha',
  sourceTree: 'source-tree',
}
const reactManifest: PackageReleaseArtifactManifest = {
  ...sdkManifest,
  packages: [{
    dependency: { name: '@openwaggle/extension-sdk', version: '0.1.1' },
    file: 'extension-react.tgz',
    integrity: 'sha512-react',
    key: 'extension-react',
    name: '@openwaggle/extension-react',
    releaseNotes: 'React notes',
    sha256: 'react',
    tag: 'extension-react-v0.1.1',
    version: '0.1.1',
  }],
}

function registryReader(reads: Array<Error | null | string>) {
  return vi.fn(async () => {
    const result = reads.shift()
    if (result === undefined) throw new Error('Unexpected registry read.')
    if (result instanceof Error) throw result
    return result
  })
}

function dependencies(readRegistryIntegrity: ReturnType<typeof registryReader>) {
  return {
    ensureGitHubRelease: vi.fn(),
    ensureTag: vi.fn(),
    publish: vi.fn(),
    readRegistryIntegrity,
    sleep: vi.fn(async () => undefined),
  }
}

describe('package release promotion registry retries', () => {
  it('retries a transient initial npm integrity read before publishing', async () => {
    const readRegistryIntegrity = registryReader([new Error('ETIMEDOUT'), null, 'sha512-sdk'])
    const promotion = dependencies(readRegistryIntegrity)

    await promoteVerifiedPackageRelease(sdkPlan, sdkManifest, '/artifacts', promotion)

    expect(readRegistryIntegrity).toHaveBeenCalledTimes(3)
    expect(promotion.sleep).toHaveBeenCalledExactlyOnceWith(5_000)
  })

  it('retries a transient npm integrity read while waiting for acceptance', async () => {
    const readRegistryIntegrity = registryReader([
      null,
      new Error('503 Service Unavailable'),
      'sha512-sdk',
    ])
    const promotion = dependencies(readRegistryIntegrity)

    await promoteVerifiedPackageRelease(sdkPlan, sdkManifest, '/artifacts', promotion)

    expect(readRegistryIntegrity).toHaveBeenCalledTimes(3)
    expect(promotion.sleep).toHaveBeenCalledExactlyOnceWith(5_000)
  })

  it('retries a transient catch-path integrity read before retrying publication', async () => {
    const readRegistryIntegrity = registryReader([null, new Error('E503'), null, 'sha512-sdk'])
    const promotion = dependencies(readRegistryIntegrity)
    promotion.publish
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(undefined)

    await promoteVerifiedPackageRelease(sdkPlan, sdkManifest, '/artifacts', promotion)

    expect(promotion.publish).toHaveBeenCalledTimes(2)
    expect(promotion.sleep.mock.calls).toEqual([[5_000], [10_000]])
  })

  it('retries a transient dependency availability read', async () => {
    const readRegistryIntegrity = registryReader([
      new Error('EAI_AGAIN'),
      'sha512-sdk',
      null,
      'sha512-react',
    ])
    const promotion = dependencies(readRegistryIntegrity)

    await promoteVerifiedPackageRelease(sdkPlan, reactManifest, '/artifacts', promotion)

    expect(readRegistryIntegrity).toHaveBeenCalledTimes(4)
    expect(promotion.sleep).toHaveBeenCalledExactlyOnceWith(5_000)
  })

  it('does not retry deterministic registry failures and bounds transient retries', async () => {
    const deterministicRead = registryReader([new Error('npm returned invalid integrity JSON')])
    const deterministicPromotion = dependencies(deterministicRead)
    await expect(
      promoteVerifiedPackageRelease(sdkPlan, sdkManifest, '/artifacts', deterministicPromotion),
    ).rejects.toThrow('invalid integrity JSON')
    expect(deterministicRead).toHaveBeenCalledTimes(1)
    expect(deterministicPromotion.sleep).not.toHaveBeenCalled()

    const transientRead = registryReader([
      new Error('ETIMEDOUT'),
      new Error('ETIMEDOUT'),
      new Error('ETIMEDOUT'),
    ])
    const transientPromotion = dependencies(transientRead)
    await expect(
      promoteVerifiedPackageRelease(sdkPlan, sdkManifest, '/artifacts', transientPromotion),
    ).rejects.toThrow('ETIMEDOUT')
    expect(transientRead).toHaveBeenCalledTimes(3)
    expect(transientPromotion.sleep).toHaveBeenCalledTimes(2)
  })
})
