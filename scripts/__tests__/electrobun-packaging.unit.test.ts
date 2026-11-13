import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveBuildIdentity } from '../build-identity'
import {
  electrobunAppConfig,
  PACKAGED_APP_LAYOUT,
  PATCH_BASE_URL_ENV,
  RELEASE_BASE_URL_ENV,
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

  it('gives Hutch a Windows icon it can embed on every channel', () => {
    expect(configFor('stable').build.win.icon).toBe('build/icon.ico')
    // The channel PNGs are 512 px; Hutch embeds a PNG only up to 256 px (stage.ts resizes it).
    expect(configFor('beta').build.win.icon).toBe('out/electrobun/stage/icon-windows.png')
  })

  it('copies the staged app into the layout the main process resolves', () => {
    const { copy } = configFor('stable').build
    expect(Object.values(copy)).toEqual([
      PACKAGED_APP_LAYOUT.main,
      PACKAGED_APP_LAYOUT.preload,
      PACKAGED_APP_LAYOUT.renderer,
      PACKAGED_APP_LAYOUT.nodeModules,
      PACKAGED_APP_LAYOUT.resources,
      PACKAGED_APP_LAYOUT.packageJson,
    ])
    expect(PACKAGED_APP_LAYOUT.main).toBe('out/main')
  })

  it('uses the system webview, CEF on macOS and Linux, and no CEF on Windows', () => {
    const { mac, win, linux } = configFor('stable').build
    expect([mac.defaultRenderer, win.defaultRenderer, linux.defaultRenderer]).toEqual([
      'native',
      'native',
      'cef',
    ])
    expect([mac.bundleCEF, win.bundleCEF, linux.bundleCEF]).toEqual([true, false, true])
    // WebView2's Chromium environment serves the preview on a port chosen per launch.
    expect(win.chromiumFlags).toEqual({ 'remote-debugging-port': 'launch' })
  })

  it('gives CEF a per-launch DevTools port and drops the defaults that weaken it', () => {
    const { mac, linux } = configFor('stable').build
    const flags = {
      'remote-debugging-port': 'launch',
      'remote-allow-origins': false,
      'allow-insecure-localhost': false,
      'disable-web-security': false,
    }
    expect(mac.chromiumFlags).toEqual(flags)
    // Linux's first page load does not wait on the desktop portal's Secret interface, and the GPU,
    // network and audio services run in the browser process.
    expect(linux.chromiumFlags).toEqual({
      ...flags,
      'in-process-gpu': true,
      'enable-features': 'NetworkServiceInProcess',
      'disable-features':
        'DbusSecretPortal,AudioServiceOutOfProcess,SpareRendererForSitePerProcess',
    })
    expect(mac).toMatchObject({ codesign: false, notarize: false, createDmg: false })
  })

  it('generates delta patches only against a given earlier release', () => {
    expect(configFor('beta').release).toEqual({
      baseUrl: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v1.2.3-beta.4',
      generatePatch: false,
    })
    expect(
      configFor('beta', { [RELEASE_BASE_URL_ENV]: 'http://127.0.0.1:8765/current' }).release,
    ).toEqual({ baseUrl: 'http://127.0.0.1:8765/current', generatePatch: false })
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

  it('leaves out the builds for other runtimes and engines the app never loads', () => {
    const transformers = '@huggingface/transformers'
    expect(shipsPackageFile(transformers, 'dist/transformers.node.cjs', target)).toBe(true)
    expect(shipsPackageFile(transformers, 'dist/transformers.node.mjs', target)).toBe(true)
    expect(shipsPackageFile(transformers, 'dist/transformers.web.js', target)).toBe(false)
    expect(shipsPackageFile(transformers, 'src/models.js', target)).toBe(false)
    expect(shipsPackageFile('lucide', 'dist/cjs/lucide.js', target)).toBe(true)
    expect(shipsPackageFile('lucide', 'dist/umd/lucide.min.js', target)).toBe(false)
    expect(shipsPackageFile('underscore', 'underscore-node.cjs', target)).toBe(true)
    expect(shipsPackageFile('underscore', 'modules/index.js', target)).toBe(false)
    expect(shipsPackageFile('tesseract.js-core', 'tesseract-core-simd-lstm.wasm', target)).toBe(
      true,
    )
    expect(shipsPackageFile('tesseract.js-core', 'tesseract-core-simd.wasm', target)).toBe(false)
    expect(shipsPackageFile('tesseract.js-core', 'tesseract-core.wasm.js', target)).toBe(false)
    expect(shipsPackageFile('playwright-core', 'lib/vite/recorder/index.html', target)).toBe(false)
    expect(shipsPackageFile('playwright-core', 'lib/server/index.js', target)).toBe(true)
  })

  it('leaves out what the main bundle inlines, except what main resolves by path', () => {
    const roots = externalRoots({
      dependencies: { 'better-sqlite3': '1', zod: '1', mammoth: '1', unpdf: '1' },
    })
    // The build's own externals (scripts/build-main.ts), without `ws`'s optional speedups, and the
    // attachment parser's packages, which it loads from node_modules.
    expect(roots).toEqual(['better-sqlite3', 'mammoth', 'unpdf'])
  })
})

describe('macosSigningOrder', () => {
  it('signs the deepest code first, each bundle after its contents, and the app with its main executable last', async () => {
    const app = path.join(await scratch(), 'OpenWaggle.app')
    const framework = path.join(app, 'Contents', 'Frameworks', 'Squirrel.framework')
    await fs.mkdir(path.join(framework, 'Versions', 'A'), { recursive: true })
    await fs.mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true })
    await fs.writeFile(path.join(framework, 'Versions', 'A', 'Squirrel'), MACH_O_64)
    await fs.writeFile(path.join(app, 'Contents', 'MacOS', 'bun'), MACH_O_64)
    await fs.writeFile(path.join(app, 'Contents', 'MacOS', 'OpenWaggle'), MACH_O_64)
    await fs.writeFile(
      path.join(app, 'Contents', 'Info.plist'),
      '<plist><dict><key>CFBundleExecutable</key>\n<string>OpenWaggle</string></dict></plist>',
    )
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
