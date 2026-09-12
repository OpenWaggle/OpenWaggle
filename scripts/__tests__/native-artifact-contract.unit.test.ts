import { describe, expect, it } from 'vitest'
import {
  materializeNativeArtifactPath,
  nativeArtifactRequirements,
} from '../native-artifact-contract'

describe('native artifact contract', () => {
  it('requires every Windows node-pty addon and runtime helper from the source build', () => {
    const requirements = nativeArtifactRequirements('node-pty', {
      platform: 'win32',
      arch: 'x64',
      libc: 'glibc',
    })

    expect(requirements.flatMap((requirement) => requirement.candidates)).toEqual([
      { packageName: 'node-pty', relativePath: 'build/Release/pty.node' },
      { packageName: 'node-pty', relativePath: 'build/Release/conpty.node' },
      { packageName: 'node-pty', relativePath: 'build/Release/conpty_console_list.node' },
      { packageName: 'node-pty', relativePath: 'build/Release/winpty-agent.exe' },
      { packageName: 'node-pty', relativePath: 'build/Release/winpty.dll' },
      { packageName: 'node-pty', relativePath: 'build/Release/conpty/conpty.dll' },
      { packageName: 'node-pty', relativePath: 'build/Release/conpty/OpenConsole.exe' },
    ])
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
