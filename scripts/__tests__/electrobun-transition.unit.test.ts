import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildMacosTransitionZip,
  type CommandRunner,
  developerIdRequirement,
} from '../electrobun-transition/macos-transition-zip'
import {
  renderAppRun,
  transitionDesktopEntry,
} from '../electrobun-transition/linux-transition-appimage'
import {
  prepareMacosTransitionBundle,
  squirrelFrameworkInfoPlist,
} from '../electrobun-transition/macos-transition-bundle'
import {
  renderTransitionMetadata,
  transitionMetadataFilename,
  writeTransitionMetadata,
} from '../electrobun-transition/update-metadata'
import {
  electrobunSetupExecutable,
  ELECTRON_BUILDER_GUID_NAMESPACE,
  nsisDefines,
  nsisVersionQuad,
  uuidV5,
} from '../electrobun-transition/windows-transition-installer'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function scratch() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-transition-'))
  roots.push(root)
  return root
}

describe('transition update metadata', () => {
  it('uses the file names electron-updater requests for each channel and platform', () => {
    expect(transitionMetadataFilename('stable', 'mac')).toBe('latest-mac.yml')
    expect(transitionMetadataFilename('rc', 'windows')).toBe('rc.yml')
    expect(transitionMetadataFilename('beta', 'linux')).toBe('beta-linux.yml')
  })

  it('lists sha512 and size for each artifact and names the x64 zip as the primary macOS file', async () => {
    const root = await scratch()
    await fs.writeFile(path.join(root, 'openwaggle-1.0.0-rc.1-arm64.zip'), 'arm')
    await fs.writeFile(path.join(root, 'openwaggle-1.0.0-rc.1-x64.zip'), 'intel')
    const name = await writeTransitionMetadata({
      directory: root,
      version: '1.0.0-rc.1',
      platform: 'mac',
      channel: 'rc',
      files: ['openwaggle-1.0.0-rc.1-arm64.zip', 'openwaggle-1.0.0-rc.1-x64.zip'],
      releaseDate: '2026-01-01T00:00:00.000Z',
    })
    expect(name).toBe('rc-mac.yml')
    const yaml = await fs.readFile(path.join(root, name), 'utf8')
    // sha512 of "intel", base64, as electron-updater compares it.
    expect(yaml).toContain(
      'sha512: "WnOMmzdVEfMhnDuGaxCjqnh91p0lnXVpJrX+bWztVAy2Zx23i0KbFFQviWFjZ8OktVPCgkndv3paKD3Y20OZqg=="',
    )
    expect(yaml).toContain('path: "openwaggle-1.0.0-rc.1-x64.zip"')
    expect(yaml).toContain('size: 5')
    expect(yaml).not.toContain('isAdminRightsRequired')
  })

  it('refuses artifacts electron-updater would not select', async () => {
    const root = await scratch()
    await fs.writeFile(path.join(root, 'OpenWaggle-Setup.zip'), 'zip')
    await expect(
      writeTransitionMetadata({
        directory: root,
        version: '1.0.0',
        platform: 'windows',
        channel: 'stable',
        files: ['OpenWaggle-Setup.zip'],
      }),
    ).rejects.toThrow(/not named like a windows artifact/u)
  })

  it('marks the Windows wrapper as a per-user install', () => {
    const yaml = renderTransitionMetadata({
      version: '1.0.0',
      platform: 'windows',
      files: [{ url: 'openwaggle-1.0.0-x64.exe', sha512: 'abc', size: 3 }],
      releaseDate: '2026-01-01T00:00:00.000Z',
    })
    expect(yaml).toContain('    isAdminRightsRequired: false\n')
    expect(yaml).toContain('path: "openwaggle-1.0.0-x64.exe"')
  })
})

describe('Windows transition installer', () => {
  it('derives the GUID the Electron NSIS installer registered under', () => {
    // electron-builder's UUID.v5("com.openwaggle.app", ELECTRON_BUILDER_NS_UUID).
    expect(uuidV5('com.openwaggle.app', ELECTRON_BUILDER_GUID_NAMESPACE)).toBe(
      'eba4cae6-ba0d-5370-b0d3-361fac615ae2',
    )
  })

  it('turns release versions into the four numbers NSIS needs', () => {
    expect(nsisVersionQuad('1.2.3')).toBe('1.2.3.0')
    expect(nsisVersionQuad('1.0.0-rc.4')).toBe('1.0.0.4')
    expect(() => nsisVersionQuad('1.0')).toThrow(/not a release version/u)
  })

  it('passes the Electrobun install location and the old uninstall key to the script', () => {
    const defines = nsisDefines({
      outFile: 'out.exe',
      version: '1.0.0-beta.2',
      setupDirectory: 'C:\\setup',
      setupExecutable: 'OpenWaggle-Setup-canary.exe',
      electrobunChannel: 'canary',
      icon: 'icon.ico',
    })
    expect(defines).toMatchObject({
      APP_GUID: 'eba4cae6-ba0d-5370-b0d3-361fac615ae2',
      EB_IDENTIFIER: 'com.openwaggle.app',
      EB_CHANNEL: 'canary',
      VERSION_QUAD: '1.0.0.2',
      PRODUCT_NAME: 'OpenWaggle',
    })
  })

  it('finds the one visible setup executable in the Electrobun Setup zip', () => {
    expect(electrobunSetupExecutable(['.installer', 'OpenWaggle-Setup.exe'])).toBe(
      'OpenWaggle-Setup.exe',
    )
    expect(() => electrobunSetupExecutable(['.installer'])).toThrow(/found none/u)
  })
})

describe('Linux transition AppImage', () => {
  it('fills the AppRun template and refuses values a shell would interpret', () => {
    const template = "IDENTIFIER='@IDENTIFIER@'\nCHANNEL='@CHANNEL@'\nVERSION='@VERSION@'\n"
    expect(
      renderAppRun(template, {
        identifier: 'com.openwaggle.app',
        channel: 'stable',
        version: '1.0.0',
      }),
    ).toBe("IDENTIFIER='com.openwaggle.app'\nCHANNEL='stable'\nVERSION='1.0.0'\n")
    expect(() =>
      renderAppRun(template, { identifier: "x'; rm -rf ~; '", channel: 'stable', version: '1' }),
    ).toThrow(/Unsafe AppRun identifier/u)
  })

  it('declares the version install.sh reads for its downgrade guard', () => {
    expect(transitionDesktopEntry('1.0.0-rc.1')).toContain('X-AppImage-Version=1.0.0-rc.1\n')
  })

  it('keeps the AppRun script in sync with the placeholders it fills', async () => {
    const appRun = await fs.readFile(
      path.join(import.meta.dirname, '..', '..', 'build', 'electrobun-transition', 'AppRun.sh'),
      'utf8',
    )
    expect(appRun).toContain("IDENTIFIER='@IDENTIFIER@'")
    expect(appRun).toContain("CHANNEL='@CHANNEL@'")
    expect(appRun).toContain("VERSION='@VERSION@'")
  })
})

describe('macOS transition zip', () => {
  it('builds the Developer ID requirement Squirrel.Mac enforces', () => {
    expect(developerIdRequirement('com.openwaggle.app', 'ABCDE12345')).toContain(
      'identifier "com.openwaggle.app" and anchor apple generic',
    )
    expect(developerIdRequirement('com.openwaggle.app', 'ABCDE12345')).toMatch(
      /leaf\[subject\.OU\] = ABCDE12345$/u,
    )
  })

  async function appBundle() {
    const root = await scratch()
    const app = path.join(root, 'OpenWaggle.app')
    await fs.mkdir(path.join(app, 'Contents'), { recursive: true })
    await fs.writeFile(path.join(app, 'Contents', 'Info.plist'), '<plist/>')
    return { root, app }
  }

  it('checks the bundle id and the old requirement before zipping with ditto', async () => {
    const { root, app } = await appBundle()
    const runner = vi.fn<CommandRunner>(async (command) => ({
      stdout: command === 'plutil' ? 'com.openwaggle.app\n' : '',
      stderr: '',
    }))
    const outFile = path.join(root, 'openwaggle-1.0.0-arm64.zip')
    await buildMacosTransitionZip({
      app,
      outFile,
      bundleId: 'com.openwaggle.app',
      requirement: 'identifier "com.openwaggle.app"',
      runner,
    })
    expect(runner.mock.calls.map(([command, args]) => [command, args[0]])).toEqual([
      ['plutil', '-extract'],
      ['codesign', '--verify'],
      ['codesign', '--verify'],
      ['ditto', '-c'],
    ])
    expect(runner.mock.calls[2]?.[1]).toContain('-R=identifier "com.openwaggle.app"')
    expect(runner.mock.calls[3]?.[1].slice(-2)).toEqual([app, outFile])
  })

  it('refuses a bundle Squirrel.Mac would reject for its identifier', async () => {
    const { root, app } = await appBundle()
    const runner: CommandRunner = async () => ({ stdout: 'dev.electrobun.app\n', stderr: '' })
    await expect(
      buildMacosTransitionZip({
        app,
        outFile: path.join(root, 'out.zip'),
        bundleId: 'com.openwaggle.app',
        runner,
      }),
    ).rejects.toThrow(/has bundle identifier dev.electrobun.app/u)
  })
})

describe('macOS transition bundle', () => {
  it('makes OpenWaggle the executable, keeps the launcher and adds the Squirrel.Mac relaunch path', async () => {
    const root = await scratch()
    const app = path.join(root, 'OpenWaggle.app')
    await fs.mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true })
    await fs.writeFile(path.join(app, 'Contents', 'Info.plist'), '<plist/>')
    await fs.writeFile(path.join(app, 'Contents', 'MacOS', 'launcher'), 'launcher')
    const runner = vi.fn<CommandRunner>(async (command, args) => {
      if (command === 'clang') await fs.writeFile(args[args.indexOf('-o') + 1] ?? '', 'mach-o')
      if (command === 'cp') await fs.copyFile(args[0] ?? '', args[1] ?? '')
      return { stdout: command === 'plutil' ? 'launcher\n' : '', stderr: '' }
    })
    await expect(prepareMacosTransitionBundle({ app, runner })).resolves.toEqual({
      previousExecutable: 'launcher',
    })
    await expect(
      fs.readFile(path.join(app, 'Contents', 'MacOS', 'OpenWaggle'), 'utf8'),
    ).resolves.toBe('launcher')
    // Electrobun's updater stages an update only when its bundle has Contents/MacOS/launcher.
    await expect(
      fs.readFile(path.join(app, 'Contents', 'MacOS', 'launcher'), 'utf8'),
    ).resolves.toBe('launcher')
    expect(
      runner.mock.calls.find(
        ([command, args]) => command === 'plutil' && args[0] === '-replace',
      )?.[1],
    ).toEqual([
      '-replace',
      'CFBundleExecutable',
      '-string',
      'OpenWaggle',
      path.join(app, 'Contents', 'Info.plist'),
    ])
    // The path ShipIt starts, through the framework's symlinks.
    const framework = path.join(app, 'Contents', 'Frameworks', 'Squirrel.framework')
    await expect(fs.readFile(path.join(framework, 'Resources', 'ShipIt'), 'utf8')).resolves.toBe(
      'mach-o',
    )
    await expect(fs.readlink(path.join(framework, 'Squirrel'))).resolves.toBe(
      'Versions/Current/Squirrel',
    )
    expect(runner.mock.calls.find(([command]) => command === 'clang')?.[1]).toEqual(
      expect.arrayContaining(['-arch', 'arm64', 'x86_64', '-mmacosx-version-min=11.0']),
    )
  })

  it('declares the relauncher framework under the app identifier', () => {
    expect(squirrelFrameworkInfoPlist('com.openwaggle.app')).toContain(
      '<string>com.openwaggle.app.squirrel-relaunch</string>',
    )
  })
})
