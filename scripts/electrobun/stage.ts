/**
 * Stages everything the Electrobun app ships for Hutch's `copy` (scripts/electrobun/app-config.ts),
 * in `out/electrobun/stage/`:
 *
 * - `main/`: the main build (`out/main`, scripts/build-main.ts), or with `--stand-in` (or when
 *   `out/main/boot.js` does not exist and `--require-main` is not given) the packaging stand-in
 *   (scripts/electrobun/stand-in/boot.ts) bundled with the Electrobun SDK from `.hutch/devkit`;
 * - `preload/`: the Electrobun preload (`out/preload`, scripts/build-electrobun-preload.ts), which
 *   the main window injects; a stand-in main opens no window and needs none;
 * - `renderer/`: the Vite renderer build (`out/renderer`), without its build manifest and maps;
 * - `node_modules/`: the production externals for the target (scripts/electrobun/stage-node-modules.ts);
 * - `resources/`: what electron-builder shipped as `extraResources` (the channel icon, installed
 *   docs, the embedding model, install.sh, third-party notices) and, on Windows, the WebView2
 *   Evergreen bootstrapper from the native layer build;
 * - `package.json` and, on macOS, `icon.iconset` from the channel's `.icns`.
 *
 *   bun scripts/electrobun/stage.ts [--stand-in | --require-main] [--arch x64|arm64]
 *     [--webview2 <MicrosoftEdgeWebview2Setup.exe>] [--allow-missing-resources]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { isRecord } from '../../src/shared/utils/validation'
import { ELECTROBUN_SDK_ENTRIES } from '../build-main'
import { resolveBuildIdentity, resolveIconBasePath, resolveMacIconPath } from '../build-identity'
import { ELECTROBUN_STAGE_DIR, PACKAGED_APP_LAYOUT } from './app-config'
import { stageNodeModules, type StageTarget } from './stage-node-modules'

const FIRST_CLI_ARGUMENT = 2
const JSON_INDENT = 2
const STAND_IN_ENTRY = 'scripts/electrobun/stand-in/boot.ts'
const MAIN_BUILD = 'out/main'
const RENDERER_BUILD = 'out/renderer'
const PRELOAD_BUILD = 'out/preload'
const PRELOAD_BUNDLE = 'electrobun.js'
const SKIPPED_BUILD_FILE = /\.(?:map|d\.ts)$/u
const SKIPPED_BUILD_DIRECTORY = '.vite'

/** electron-builder's `extraResources`: source in the checkout, name under `resources/`. */
function extraResources(channelIcon: string) {
  return [
    { from: channelIcon, to: 'icon.png' },
    { from: 'build/openwaggle-docs', to: 'openwaggle-docs' },
    { from: 'build/session-embedding-model', to: 'session-embedding-model' },
    { from: 'scripts/install.sh', to: 'openwaggle-install.sh' },
    { from: 'THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' },
  ]
}

export interface StageOptions {
  readonly root: string
  readonly target: StageTarget
  readonly mainSource: 'build' | 'stand-in' | 'auto'
  readonly webview2: string | null
  readonly allowMissingResources: boolean
  readonly environment: NodeJS.ProcessEnv
}

function copyBuildOutput(source: string, destination: string) {
  fs.rmSync(destination, { recursive: true, force: true })
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: (file) =>
      path.basename(file) !== SKIPPED_BUILD_DIRECTORY && !SKIPPED_BUILD_FILE.test(file),
  })
}

/** Bundles the stand-in with the devkit's SDK source, as the main build bundles it. */
function buildStandIn(root: string, destination: string) {
  fs.rmSync(destination, { recursive: true, force: true })
  fs.mkdirSync(destination, { recursive: true })
  const paths = Object.fromEntries(
    Object.entries(ELECTROBUN_SDK_ENTRIES).map(([specifier, file]) => {
      const absolute = path.join(root, file)
      if (!fs.existsSync(absolute)) {
        throw new Error(`${absolute} is missing; run bunx electrobun prepare.`)
      }
      return [specifier, [absolute]]
    }),
  )
  const tsconfig = path.join(destination, '..', 'stand-in.tsconfig.json')
  fs.writeFileSync(tsconfig, JSON.stringify({ compilerOptions: { paths } }))
  try {
    execFileSync(
      process.execPath,
      [
        'build',
        path.join(root, STAND_IN_ENTRY),
        '--target=bun',
        '--format=esm',
        `--tsconfig-override=${tsconfig}`,
        `--outfile=${path.join(destination, 'boot.js')}`,
      ],
      { cwd: root, stdio: 'inherit' },
    )
  } finally {
    fs.rmSync(tsconfig, { force: true })
  }
}

function stageMain(options: StageOptions, stage: string) {
  const destination = path.join(stage, PACKAGED_APP_LAYOUT.main)
  const built = fs.existsSync(path.join(options.root, MAIN_BUILD, 'boot.js'))
  if (options.mainSource === 'build' && !built) {
    throw new Error(`${MAIN_BUILD}/boot.js is missing; build the main process first.`)
  }
  if (options.mainSource === 'stand-in' || !built) {
    buildStandIn(options.root, destination)
    // Hutch copies every staged directory; the stand-in opens no window, so its preload is empty.
    const preload = path.join(stage, PACKAGED_APP_LAYOUT.preload)
    fs.rmSync(preload, { recursive: true, force: true })
    fs.mkdirSync(preload, { recursive: true })
    return 'stand-in'
  }
  copyBuildOutput(path.join(options.root, MAIN_BUILD), destination)
  stagePreload(options, stage)
  return 'build'
}

function stagePreload(options: StageOptions, stage: string) {
  const source = path.join(options.root, PRELOAD_BUILD)
  if (!fs.existsSync(path.join(source, PRELOAD_BUNDLE))) {
    throw new Error(`${PRELOAD_BUILD}/${PRELOAD_BUNDLE} is missing; run the build.`)
  }
  copyBuildOutput(source, path.join(stage, PACKAGED_APP_LAYOUT.preload))
}

function stageRenderer(options: StageOptions, stage: string) {
  const destination = path.join(stage, PACKAGED_APP_LAYOUT.renderer)
  const source = path.join(options.root, RENDERER_BUILD)
  if (fs.existsSync(path.join(source, 'index.html'))) {
    copyBuildOutput(source, destination)
    return true
  }
  if (!options.allowMissingResources) {
    throw new Error(`${RENDERER_BUILD} is missing; run the build.`)
  }
  fs.rmSync(destination, { recursive: true, force: true })
  fs.mkdirSync(destination, { recursive: true })
  fs.writeFileSync(
    path.join(destination, 'index.html'),
    '<!doctype html><title>OpenWaggle</title>\n',
  )
  return false
}

function stageResources(options: StageOptions, stage: string, channelIcon: string) {
  const destination = path.join(stage, PACKAGED_APP_LAYOUT.resources)
  fs.rmSync(destination, { recursive: true, force: true })
  fs.mkdirSync(destination, { recursive: true })
  const missing: string[] = []
  for (const resource of extraResources(channelIcon)) {
    const source = path.join(options.root, resource.from)
    if (!fs.existsSync(source)) {
      missing.push(resource.from)
      continue
    }
    fs.cpSync(source, path.join(destination, resource.to), { recursive: true, dereference: true })
  }
  if (options.target.platform === 'win32') {
    if (options.webview2 === null || !fs.existsSync(options.webview2)) {
      missing.push('the WebView2 bootstrapper (--webview2)')
    } else {
      const webview2 = path.join(destination, 'webview2')
      fs.mkdirSync(webview2, { recursive: true })
      fs.copyFileSync(options.webview2, path.join(webview2, path.basename(options.webview2)))
    }
  }
  if (missing.length > 0 && !options.allowMissingResources) {
    throw new Error(`Missing app resources: ${missing.join(', ')}.`)
  }
  return missing
}

function stageMacIconset(options: StageOptions, stage: string, macIcon: string) {
  const iconset = path.join(stage, 'icon.iconset')
  fs.rmSync(iconset, { recursive: true, force: true })
  if (options.target.platform !== 'darwin') return
  execFileSync('iconutil', ['-c', 'iconset', path.join(options.root, macIcon), '-o', iconset])
}

function stagePackageJson(options: StageOptions, stage: string) {
  const parsed: unknown = JSON.parse(
    fs.readFileSync(path.join(options.root, 'package.json'), 'utf8'),
  )
  const source = isRecord(parsed) ? parsed : {}
  const pick = (key: string) => source[key]
  const manifest = {
    name: pick('name'),
    productName: resolveBuildIdentity(options.environment).productName,
    version: pick('version'),
    description: pick('description'),
    type: 'module',
    main: `${PACKAGED_APP_LAYOUT.main}/boot.js`,
  }
  fs.writeFileSync(
    path.join(stage, PACKAGED_APP_LAYOUT.packageJson),
    `${JSON.stringify(manifest, null, JSON_INDENT)}\n`,
  )
}

export async function stageElectrobunApp(options: StageOptions) {
  const stage = path.join(options.root, ELECTROBUN_STAGE_DIR)
  fs.mkdirSync(stage, { recursive: true })
  const { channel } = resolveBuildIdentity(options.environment)
  const main = stageMain(options, stage)
  const renderer = stageRenderer(options, stage)
  const missingResources = stageResources(options, stage, resolveIconBasePath(channel, 'build'))
  stageMacIconset(options, stage, resolveMacIconPath(channel, 'build'))
  stagePackageJson(options, stage)
  const packages = stageNodeModules(options.root, stage, options.target)
  const manifest = {
    channel,
    target: options.target,
    main,
    renderer,
    missingResources,
    packages: packages.map((entry) => entry.placement).sort(),
  }
  fs.writeFileSync(
    path.join(stage, 'stage-manifest.json'),
    `${JSON.stringify(manifest, null, JSON_INDENT)}\n`,
  )
  return manifest
}

function parseCli(argv: readonly string[]) {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      'stand-in': { type: 'boolean', default: false },
      'require-main': { type: 'boolean', default: false },
      arch: { type: 'string', default: process.arch },
      webview2: { type: 'string' },
      'allow-missing-resources': { type: 'boolean', default: false },
    },
  })
  if (values['stand-in'] && values['require-main']) {
    throw new Error('--stand-in and --require-main exclude each other.')
  }
  const mainSource: StageOptions['mainSource'] = values['stand-in']
    ? 'stand-in'
    : values['require-main']
      ? 'build'
      : 'auto'
  return {
    root: process.cwd(),
    target: { platform: process.platform, arch: values.arch },
    mainSource,
    webview2: values.webview2 ?? null,
    allowMissingResources: values['allow-missing-resources'],
    environment: process.env,
  } satisfies StageOptions
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  stageElectrobunApp(parseCli(process.argv.slice(FIRST_CLI_ARGUMENT))).then(
    (manifest) => {
      const { packages, ...summary } = manifest
      console.log(JSON.stringify({ ...summary, packages: packages.length }))
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    },
  )
}
