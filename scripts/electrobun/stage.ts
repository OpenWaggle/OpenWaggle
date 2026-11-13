/**
 * Stages everything the Electrobun app ships for Hutch's `copy` (scripts/electrobun/app-config.ts),
 * in `out/electrobun/stage/`:
 *
 * - `main/`: the main build (`out/main`, scripts/build-main.ts);
 * - `preload/`: the Electrobun preload (`out/preload`, scripts/build-electrobun-preload.ts), which
 *   the main window injects;
 * - `renderer/`: the Vite renderer build (`out/renderer`), without its build manifest and maps;
 * - `node_modules/`: the production externals for the target (scripts/electrobun/stage-node-modules.ts);
 * - `resources/`: the bundled resources (`stagedResources`: the channel icon, installed
 *   docs, the embedding model, install.sh, third-party notices) and, on Windows, the WebView2
 *   Evergreen bootstrapper from the native layer build;
 * - `package.json`; on macOS `icon.iconset` from the channel's `.icns`, on Windows a 256 px
 *   `icon-windows.png` of the channel icon for channels without an `.ico` (app-config.ts).
 *
 *   bun scripts/electrobun/stage.ts [--arch x64|arm64]
 *     [--webview2 <MicrosoftEdgeWebview2Setup.exe>] [--allow-missing-resources]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import sharp from 'sharp'
import { isRecord } from '../../src/shared/utils/validation'
import { resolveBuildIdentity, resolveIconBasePath, resolveMacIconPath } from '../build-identity'
import { ELECTROBUN_STAGE_DIR, PACKAGED_APP_LAYOUT, WINDOWS_ICON_PNG } from './app-config'
import { stageNodeModules, type StageTarget } from './stage-node-modules'

const FIRST_CLI_ARGUMENT = 2
const JSON_INDENT = 2
const MAIN_BUILD = 'out/main'
const RENDERER_BUILD = 'out/renderer'
const PRELOAD_BUILD = 'out/preload'
/** The checkout paths the app directory copies besides `node_modules` and `resources/`. */
export const STAGED_BUILD_PATHS = [
  MAIN_BUILD,
  PRELOAD_BUILD,
  RENDERER_BUILD,
  'package.json',
] as const
const PRELOAD_BUNDLE = 'electrobun.js'
const SKIPPED_BUILD_FILE = /\.(?:map|d\.ts)$/u
const SKIPPED_BUILD_DIRECTORY = '.vite'

/** The bundled resources: source in the checkout, name under `resources/`. */
export function stagedResources(channelIcon: string) {
  return [
    { from: channelIcon, to: 'icon.png' },
    { from: 'build/openwaggle-docs', to: 'openwaggle-docs' },
    { from: 'scripts/install.sh', to: 'openwaggle-install.sh' },
    { from: 'THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' },
  ]
}

export interface StageOptions {
  readonly root: string
  readonly target: StageTarget
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

function stageMain(options: StageOptions, stage: string) {
  if (!fs.existsSync(path.join(options.root, MAIN_BUILD, 'boot.js'))) {
    throw new Error(`${MAIN_BUILD}/boot.js is missing; build the main process first.`)
  }
  copyBuildOutput(path.join(options.root, MAIN_BUILD), path.join(stage, PACKAGED_APP_LAYOUT.main))
  stagePreload(options, stage)
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
  for (const resource of stagedResources(channelIcon)) {
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

const WINDOWS_ICON_SIZE = 256

async function stageWindowsIcon(options: StageOptions, stage: string, channelIcon: string) {
  const icon = path.join(stage, WINDOWS_ICON_PNG)
  fs.rmSync(icon, { force: true })
  if (options.target.platform !== 'win32') return
  await sharp(path.join(options.root, channelIcon))
    .resize(WINDOWS_ICON_SIZE, WINDOWS_ICON_SIZE)
    .png()
    .toFile(icon)
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
  stageMain(options, stage)
  const renderer = stageRenderer(options, stage)
  const missingResources = stageResources(options, stage, resolveIconBasePath(channel, 'build'))
  stageMacIconset(options, stage, resolveMacIconPath(channel, 'build'))
  await stageWindowsIcon(options, stage, resolveIconBasePath(channel, 'build'))
  stagePackageJson(options, stage)
  const packages = stageNodeModules(options.root, stage, options.target)
  const manifest = {
    channel,
    target: options.target,
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
      arch: { type: 'string', default: process.arch },
      webview2: { type: 'string' },
      'allow-missing-resources': { type: 'boolean', default: false },
    },
  })
  return {
    root: process.cwd(),
    target: { platform: process.platform, arch: values.arch },
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
