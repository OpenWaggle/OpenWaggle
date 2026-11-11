import { describe, expect, it } from 'vitest'
import {
  materializeNativeArtifactPath,
  nativeArtifactRequirements,
} from '../native-artifact-contract'

describe('native artifact contract', () => {
  it('defines no contract for a package without one, such as the removed node-pty', () => {
    expect(() =>
      nativeArtifactRequirements('node-pty', { platform: 'win32', arch: 'x64', libc: 'glibc' }),
    ).toThrow('No exact native artifact contract is defined for node-pty.')
  })

  it('uses the active musl platform package paths for SQLite and Sharp', () => {
    const runtime = { platform: 'linux', arch: 'arm64', libc: 'musl' } as const
    expect(nativeArtifactRequirements('better-sqlite3', runtime)[0]?.candidates[0]).toEqual({
      packageName: 'better-sqlite3',
      relativePath: 'prebuilds/linuxmusl-arm64.node',
    })
    expect(nativeArtifactRequirements('sharp', runtime)[0]?.candidates[1]).toEqual({
      packageName: '@img/sharp-linuxmusl-arm64',
      relativePath: 'lib/sharp-linuxmusl-arm64-{version}.node',
    })
  })

  it('fails closed when a versioned artifact cannot be resolved exactly', () => {
    expect(() => materializeNativeArtifactPath('lib/addon-{version}.node', undefined)).toThrow(
      'Cannot resolve versioned native artifact path',
    )
    expect(materializeNativeArtifactPath('lib/addon-{version}.node', '1.2.3')).toBe(
      'lib/addon-1.2.3.node',
    )
  })
})
