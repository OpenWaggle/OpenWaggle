import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveBuildIdentity } from '../build-identity'
import {
  DEFAULT_RELEASE_BASE_URL,
  electrobunAppConfig,
  PACKAGED_APP_LAYOUT,
  PATCH_BASE_URL_ENV,
  packageVersion,
} from '../electrobun/app-config'
import { patchBaseRelease } from '../electrobun/patch-base-url'
import { macosSigningOrder } from '../electrobun/sign-macos'
import {
  externalRoots,
  isForeignPlatformPackage,
  shipsPackageFile,
  type StageTarget,
} from '../electrobun/stage-node-modules'

const roots: string[] = []
const MACH_O_64 = Buffer.from([0xcf, 0xfa, 0xed, 0xfe])

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function scratch() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-electrobun-package-'))
  roots.push(root)
  return root
}

function configFor(channel: string, environment: NodeJS.ProcessEnv = {}) {
  const identity = resolveBuildIdentity({ OPENWAGGLE_RELEASE_CHANNEL: channel })
  return electrobunAppConfig({ identity, version: '1.2.3-beta.4', environment })
}

describe('electrobunAppConfig', () => {
  it('keeps the canonical identity and claims session links on release channels', () => {
    const config = configFor('beta')
    expect(config.app).toMatchObject({
      name: 'OpenWaggle Beta',
      identifier: 'com.openwaggle.app',
      version: '1.2.3-beta.4',
      urlSchemes: ['openwaggle'],
    })
  })

  it('copies the staged app into the layout the main process resolves', () => {
    const { copy } = configFor('stable').build
    expect(Object.values(copy)).toEqual([
      PACKAGED_APP_LAYOUT.main,
      PACKAGED_APP_LAYOUT.renderer,
      PACKAGED_APP_LAYOUT.nodeModules,
      PACKAGED_APP_LAYOUT.resources,
      PACKAGED_APP_LAYOUT.packageJson,
    ])
    expect(PACKAGED_APP_LAYOUT.main).toBe('out/main')
  })

  it('uses the system webview with CEF bundled, and CEF for the whole app on Linux', () => {
    const { mac, win, linux } = configFor('stable').build
    expect([mac.defaultRenderer, win.defaultRenderer, linux.defaultRenderer]).toEqual([
      'native',
      'native',
      'cef',
    ])
    expect([mac.bundleCEF, win.bundleCEF, linux.bundleCEF]).toEqual([true, true, true])
    expect(mac).toMatchObject({ codesign: false, notarize: false, createDmg: false })
  })

  it('generates delta patches only against a given earlier release', () => {
    expect(configFor('beta').release).toEqual({
      baseUrl: DEFAULT_RELEASE_BASE_URL,
      generatePatch: false,
    })
    const earlier = 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v1.2.3-beta.3'
    expect(configFor('beta', { [PATCH_BASE_URL_ENV]: earlier }).release).toEqual({
      baseUrl: earlier,
      generatePatch: true,
    })
  })

  it('reads the version from package.json', async () => {
    const root = await scratch()
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '9.8.7' }))
    expect(packageVersion(root)).toBe('9.8.7')
  })
})

describe('staged node_modules', () => {
  const target: StageTarget = { platform: 'darwin', arch: 'arm64' }

  it('ships only the target platform of native packages', () => {
    expect(isForeignPlatformPackage('@img/sharp-darwin-arm64', target)).toBe(false)
    expect(isForeignPlatformPackage('@img/sharp-linux-x64', target)).toBe(true)
    expect(shipsPackageFile('better-sqlite3', 'prebuilds/darwin-arm64.node', target)).toBe(true)
    expect(shipsPackageFile('better-sqlite3', 'prebuilds/linux-x64.node', target)).toBe(false)
    expect(shipsPackageFile('better-sqlite3', 'src/better_sqlite3.cpp', target)).toBe(false)
    const onnx = 'bin/napi-v6/darwin/arm64/libonnxruntime.1.23.2.dylib'
    expect(shipsPackageFile('onnxruntime-node', onnx, target)).toBe(true)
    expect(shipsPackageFile('onnxruntime-node', onnx.replace('arm64', 'x64'), target)).toBe(false)
    expect(shipsPackageFile('onnxruntime-node', 'bin/napi-v6/linux/x64/a.so', target)).toBe(false)
  })

  it('leaves out what the main bundle inlines and the Electron-only packages', () => {
    const roots = externalRoots({
      dependencies: { 'better-sqlite3': '1', 'electron-updater': '1', 'node-pty': '1' },
    })
    expect(roots).toContain('better-sqlite3')
    expect(roots).not.toContain('electron-updater')
    expect(roots).not.toContain('node-pty')
  })
})

describe('macosSigningOrder', () => {
  it('signs the deepest code first, each bundle after its contents, and the app last', async () => {
    const app = path.join(await scratch(), 'OpenWaggle.app')
    const framework = path.join(app, 'Contents', 'Frameworks', 'Squirrel.framework')
    await fs.mkdir(path.join(framework, 'Versions', 'A'), { recursive: true })
    await fs.mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true })
    await fs.writeFile(path.join(framework, 'Versions', 'A', 'Squirrel'), MACH_O_64)
    await fs.writeFile(path.join(app, 'Contents', 'MacOS', 'bun'), MACH_O_64)
    await fs.writeFile(path.join(app, 'Contents', 'Info.plist'), '<plist/>')
    await fs.symlink('Versions/A/Squirrel', path.join(framework, 'Squirrel'))

    const order = await macosSigningOrder(app)

    expect(order.map((target) => path.relative(app, target) || '.')).toEqual([
      'Contents/Frameworks/Squirrel.framework/Versions/A/Squirrel',
      'Contents/MacOS/bun',
      'Contents/Frameworks/Squirrel.framework',
      '.',
    ])
  })
})

describe('patchBaseRelease', () => {
  const manifest = 'stable-win-x64-update-v2.json'
  const release = (tag: string, assets: readonly string[] = [manifest], draft = false) => ({
    tag,
    draft,
    assets,
  })

  it('picks the newest earlier published release with Electrobun files for the target', () => {
    const base = patchBaseRelease(
      [
        release('v1.0.0-beta.42'),
        release('v1.0.0-beta.41'),
        release('v1.0.0-beta.40'),
        release('v1.0.0-beta.39', ['beta.yml']),
        release('v1.0.0-beta.38', [manifest], true),
      ],
      '1.0.0-beta.42',
      'win-x64',
    )
    expect(base?.tag).toBe('v1.0.0-beta.41')
  })

  it('finds none before the first Electrobun release', () => {
    expect(
      patchBaseRelease([release('v1.0.0-beta.38', ['beta.yml'])], '1.0.0-beta.39', 'win-x64'),
    ).toBeNull()
  })
})
