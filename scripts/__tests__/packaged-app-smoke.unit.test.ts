import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findPackagedApps,
  packagedAppMatchesHostArchitecture,
  packagedPtyProbeInvocation,
} from '../packaged-app-smoke'
import { copyPiPackageOutOfAsar } from '../packaged-pi-package-probe'

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
        '/usr/local/bin/node',
      ),
    ).toEqual({
      command: '/release/OpenWaggle.app/Contents/MacOS/OpenWaggle',
      args: [
        '/workspace/node_modules/.cache/openwaggle/native-load-probe.mjs',
        'electron',
        '/release/OpenWaggle.app/Contents/Resources/app.asar',
        '/usr/local/bin/node',
      ],
    })
    expect(
      packagedPtyProbeInvocation(
        'C:\\release\\win-unpacked',
        'C:\\release\\app.asar',
        'C:\\workspace',
        'win32',
      ).command,
    ).toBe(path.join('C:\\release\\win-unpacked', 'OpenWaggle.exe'))
  })

  it('executes only the macOS package matching the runner architecture', () => {
    expect(
      packagedAppMatchesHostArchitecture('/dist/mac-arm64/OpenWaggle.app', 'darwin', 'arm64'),
    ).toBe(true)
    expect(packagedAppMatchesHostArchitecture('/dist/mac/OpenWaggle.app', 'darwin', 'arm64')).toBe(
      false,
    )
    expect(
      packagedAppMatchesHostArchitecture('/dist/mac-x64/OpenWaggle.app', 'darwin', 'x64'),
    ).toBe(true)
    expect(packagedAppMatchesHostArchitecture('/dist/linux-unpacked', 'linux', 'x64')).toBe(true)
  })

  it("copies only Pi's package directory out of the asar, at its node_modules path", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-copy-'))
    const contents = new Map([
      ['/node_modules/@earendil-works/pi-coding-agent/package.json', '{"name":"pi"}'],
      [
        '/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json',
        '{}',
      ],
      ['/node_modules/@earendil-works/pi-coding-agent-extra/package.json', '{}'],
      ['/out/main/index.js', ''],
    ])
    const archive = {
      files: new Map([...contents.keys()].map((file) => [file, { size: 0, offset: 0 }])),
      readFile: async (file: string) => Buffer.from(contents.get(file) ?? ''),
    }
    try {
      expect(await copyPiPackageOutOfAsar(archive, target)).toBe(2)
      const pi = path.join(target, 'node_modules', '@earendil-works', 'pi-coding-agent')
      expect(await fs.readFile(path.join(pi, 'package.json'), 'utf8')).toBe('{"name":"pi"}')
      await expect(
        fs.stat(path.join(pi, 'dist', 'modes', 'interactive', 'theme', 'dark.json')),
      ).resolves.toBeDefined()
      expect(
        (await fs.readdir(path.join(target, 'node_modules', '@earendil-works'))).sort(),
      ).toEqual(['pi-coding-agent'])
      await expect(fs.stat(path.join(target, 'out'))).rejects.toThrow()
    } finally {
      await fs.rm(target, { recursive: true, force: true })
    }
  })
})
