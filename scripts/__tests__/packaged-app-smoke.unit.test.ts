import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findPackagedApps,
  packagedAppMatchesHostArchitecture,
  packagedPtyProbeInvocation,
} from '../packaged-app-smoke'

describe('packaged app smoke', () => {
  it('discovers every macOS and unpacked platform app', async () => {
    const distDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-packaged-app-'))
    try {
      const macApp = path.join(distDirectory, 'mac-arm64', 'OpenWaggle.app')
      const linuxApp = path.join(distDirectory, 'linux-unpacked')
      await fs.mkdir(macApp, { recursive: true })
      await fs.mkdir(path.join(linuxApp, 'resources'), { recursive: true })
      await fs.writeFile(path.join(linuxApp, 'resources', 'app.asar'), 'fixture')

      await expect(findPackagedApps(['node', 'probe'], distDirectory)).resolves.toEqual(
        [linuxApp, macApp].sort((left, right) => left.localeCompare(right)),
      )
    } finally {
      await fs.rm(distDirectory, { recursive: true, force: true })
    }
  })

  it('runs the probe through the packaged Electron executable and packaged asar', () => {
    expect(
      packagedPtyProbeInvocation(
        '/release/OpenWaggle.app',
        '/release/OpenWaggle.app/Contents/Resources/app.asar',
        '/workspace',
        'darwin',
      ),
    ).toEqual({
      command: '/release/OpenWaggle.app/Contents/MacOS/OpenWaggle',
      args: [
        '--import',
        'tsx',
        '/workspace/scripts/native-load-probe.ts',
        'electron',
        '/release/OpenWaggle.app/Contents/Resources/app.asar',
        process.execPath,
      ],
    })
    expect(
      packagedPtyProbeInvocation('C:\\release\\win-unpacked', 'C:\\release\\app.asar', 'C:\\workspace', 'win32')
        .command,
    ).toBe(path.join('C:\\release\\win-unpacked', 'OpenWaggle.exe'))
  })

  it('executes only the macOS package matching the runner architecture', () => {
    expect(packagedAppMatchesHostArchitecture('/dist/mac-arm64/OpenWaggle.app', 'darwin', 'arm64')).toBe(true)
    expect(packagedAppMatchesHostArchitecture('/dist/mac/OpenWaggle.app', 'darwin', 'arm64')).toBe(false)
    expect(packagedAppMatchesHostArchitecture('/dist/mac-x64/OpenWaggle.app', 'darwin', 'x64')).toBe(true)
    expect(packagedAppMatchesHostArchitecture('/dist/linux-unpacked', 'linux', 'x64')).toBe(true)
  })
})
