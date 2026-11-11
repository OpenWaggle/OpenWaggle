/**
 * Packages OpenWaggle with Electrobun for the platform it runs on (ADR 0064), replacing
 * `electron-builder` (docs/electrobun-transition.md, "How release.yml must change"):
 *
 * 1. prepares the Electrobun SDK devkit (`electrobun prepare`), builds the main process with
 *    `bun build` (scripts/build-main.ts, into `out/main`; the renderer comes from `bun run build`),
 *    then stages the app (scripts/electrobun/stage.ts): main, renderer, the pruned production
 *    `node_modules` of the build's externals, the bundled resources. `--stand-in` stages the
 *    packaging stand-in main instead of building it;
 * 2. runs Hutch (`electrobun build --env=stable`, electrobun.config.ts). Its hooks prepare and
 *    sign the unwrapped app (scripts/electrobun/hooks-steps.ts); on macOS the app is then re-sealed
 *    with Hutch's final `version.json`, notarized and repacked (macos-reseal.ts);
 * 3. writes OpenWaggle's release files into `out/electrobun/release/`:
 *    - Electrobun's updater files unchanged: `stable-<os>-<arch>-update(-v2).json`, the `.tar.zst`
 *      archive and, with a patch base URL, the delta patch;
 *    - the transition artifact existing Electron installs update to, named as electron-builder named
 *      theirs: macOS `openwaggle-<version>-<arch>.zip` (checked against the designated requirement
 *      of the installs it replaces), Windows `openwaggle-<version>-x64.exe` (NSIS around Electrobun's
 *      Setup), Linux `openwaggle-<version>-x86_64.AppImage`;
 *    - the download for new installs: macOS `openwaggle-<version>-<arch>.dmg` of the same app
 *      (install.sh), Windows `openwaggle-<version>-x64-setup.zip`, Linux
 *      `openwaggle-<version>-linux-x64.tar.gz` (both Electrobun's Setup);
 *    - the electron-updater metadata for the transition artifacts (`metadata` below), except on
 *      macOS, where the arm64 and x64 builds run on separate runners and the release workflow
 *      writes one `*-mac.yml` for both.
 *
 *   bun scripts/electrobun/package.ts [--stand-in] [--allow-missing-resources] [--webview2 <exe>]
 *     [--requirement <designated requirement>] [--makensis <path>] [--appimagetool <path>]
 *   bun scripts/electrobun/package.ts metadata <release dir> <mac|windows|linux>
 *
 * Hutch comes from OPENWAGGLE_HUTCH (for example `hutch electrobun`, as CI installs it), else
 * `bunx electrobun`. Signing is configured through the hook environment (hooks-steps.ts).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { resolveBuildIdentity } from '../build-identity'
import { buildMain } from '../build-main'
import {
  ELECTROBUN_ARTIFACT_DIR,
  ELECTROBUN_BUILD_DIR,
  ELECTROBUN_INNER_APP_DIR,
  ELECTROBUN_RELEASE_DIR,
  packageVersion,
} from './app-config'
import { createMacosDmg } from './macos-dmg'
import { resealMacosUpdate } from './macos-reseal'
import { stageElectrobunApp } from './stage'

const FIRST_CLI_ARGUMENT = 2
const ELECTROBUN_UPDATE_FILE =
  /^stable-(macos|win|linux)-(arm64|x64)-.*(\.tar\.zst|\.patch|update(-v2)?\.json)$/u
const TRANSITION_FILE = {
  mac: /^openwaggle-.+-(arm64|x64)\.zip$/u,
  windows: /^openwaggle-.+-x64\.exe$/u,
  linux: /^openwaggle-.+-x86_64\.AppImage$/u,
} as const

type ReleasePlatform = keyof typeof TRANSITION_FILE

export interface PackageOptions {
  readonly root: string
  readonly arch: string
  readonly standIn: boolean
  readonly allowMissingResources: boolean
  readonly webview2: string | null
  readonly requirement: string | null
  readonly makensis: string | null
  readonly appimagetool: string | null
  readonly environment: NodeJS.ProcessEnv
}

function runBun(root: string, script: string, args: readonly string[]) {
  execFileSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit' })
}

function hutchCommand(environment: NodeJS.ProcessEnv) {
  const configured = (environment['OPENWAGGLE_HUTCH'] ?? '').trim().split(/\s+/u).filter(Boolean)
  return configured.length > 0 ? configured : [process.execPath, 'x', 'electrobun']
}

function electrobunOs() {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'win32') return 'win'
  return 'linux'
}

function single(directory: string, pattern: RegExp, description: string) {
  const matches = fs.readdirSync(directory).filter((name) => pattern.test(name))
  const [match] = matches
  if (matches.length !== 1 || match === undefined) {
    throw new Error(`Expected one ${description} in ${directory}, found ${matches.length}.`)
  }
  return path.join(directory, match)
}

function copyUpdateFiles(artifacts: string, release: string) {
  const copied = fs.readdirSync(artifacts).filter((name) => ELECTROBUN_UPDATE_FILE.test(name))
  if (!copied.some((name) => name.endsWith('update-v2.json'))) {
    throw new Error(`Hutch wrote no update-v2.json into ${artifacts}.`)
  }
  for (const name of copied) fs.copyFileSync(path.join(artifacts, name), path.join(release, name))
  return copied
}

async function packageMacos(
  options: PackageOptions,
  version: string,
  release: string,
  target: string,
) {
  const app = single(path.join(options.root, ELECTROBUN_INNER_APP_DIR, target), /\.app$/u, 'app')
  const base = `openwaggle-${version}-${options.arch}`
  const bundleId = resolveBuildIdentity(options.environment).appId
  const resealed = await resealMacosUpdate({
    app,
    release,
    bundleId,
    environment: options.environment,
  })
  console.log(JSON.stringify({ resealed }))
  runBun(options.root, 'scripts/electrobun-transition/macos-transition-zip.ts', [
    app,
    path.join(release, `${base}.zip`),
    bundleId,
    ...(options.requirement === null ? [] : [options.requirement]),
  ])
  await createMacosDmg({
    app,
    output: path.join(release, `${base}.dmg`),
    environment: options.environment,
  })
  return [`${base}.zip`, `${base}.dmg`]
}

function packageWindows(options: PackageOptions, version: string, release: string) {
  const artifacts = path.join(options.root, ELECTROBUN_ARTIFACT_DIR)
  const setup = single(artifacts, /-Setup.*\.zip$/u, 'Electrobun Setup zip')
  const installer = `openwaggle-${version}-x64.exe`
  const setupDownload = `openwaggle-${version}-x64-setup.zip`
  runBun(options.root, 'scripts/electrobun-transition/windows-transition-installer.ts', [
    setup,
    path.join(release, installer),
    version,
    'stable',
    ...(options.makensis === null ? [] : [options.makensis]),
  ])
  fs.copyFileSync(setup, path.join(release, setupDownload))
  return [installer, setupDownload]
}

function packageLinux(options: PackageOptions, version: string, release: string) {
  if (options.appimagetool === null) throw new Error('Linux packaging needs --appimagetool.')
  const artifacts = path.join(options.root, ELECTROBUN_ARTIFACT_DIR)
  const setup = single(artifacts, /-Setup.*\.tar\.gz$/u, 'Electrobun Setup tar.gz')
  const appImage = `openwaggle-${version}-x86_64.AppImage`
  const tarball = `openwaggle-${version}-linux-x64.tar.gz`
  runBun(options.root, 'scripts/electrobun-transition/linux-transition-appimage.ts', [
    setup,
    path.join(release, appImage),
    version,
    'stable',
    options.appimagetool,
  ])
  fs.copyFileSync(setup, path.join(release, tarball))
  return [appImage, tarball]
}

/** Writes electron-updater metadata for every transition artifact in `release`. */
export function writeTransitionMetadata(root: string, release: string, platform: ReleasePlatform) {
  const identity = resolveBuildIdentity(process.env)
  if (identity.channel === 'dev') return []
  const files = fs.readdirSync(release).filter((name) => TRANSITION_FILE[platform].test(name))
  const versions = new Set(files.map((name) => name.replace(/^openwaggle-(.+)-[^-]+$/u, '$1')))
  const [version] = versions
  if (version === undefined || versions.size !== 1) {
    throw new Error(
      `Expected transition artifacts of one version in ${release}: ${files.join(', ')}`,
    )
  }
  const script = 'scripts/electrobun-transition/update-metadata.ts'
  runBun(root, script, [release, version, platform, identity.channel, ...files.sort()])
  runBun(root, 'scripts/prepare-update-channel-metadata.ts', [release, identity.channel, platform])
  return files
}

/** The devkit the main build and the stand-in bundle the SDK from, then `out/main`. */
async function buildMainProcess(options: PackageOptions) {
  const [command = process.execPath, ...prefix] = hutchCommand(options.environment)
  execFileSync(command, [...prefix, 'prepare'], {
    cwd: options.root,
    stdio: 'inherit',
    env: options.environment,
  })
  if (!options.standIn) await buildMain()
}

export async function packageElectrobunApp(options: PackageOptions) {
  const version = packageVersion(options.root)
  await buildMainProcess(options)
  await stageElectrobunApp({
    root: options.root,
    target: { platform: process.platform, arch: options.arch },
    mainSource: options.standIn ? 'stand-in' : 'build',
    webview2: options.webview2,
    allowMissingResources: options.allowMissingResources,
    environment: options.environment,
  })
  for (const directory of [
    ELECTROBUN_BUILD_DIR,
    ELECTROBUN_ARTIFACT_DIR,
    ELECTROBUN_INNER_APP_DIR,
  ]) {
    fs.rmSync(path.join(options.root, directory), { recursive: true, force: true })
  }
  const [command = process.execPath, ...prefix] = hutchCommand(options.environment)
  execFileSync(command, [...prefix, 'build', '--env=stable'], {
    cwd: options.root,
    stdio: 'inherit',
    env: options.environment,
  })
  const release = path.join(options.root, ELECTROBUN_RELEASE_DIR)
  fs.rmSync(release, { recursive: true, force: true })
  fs.mkdirSync(release, { recursive: true })
  const updateFiles = copyUpdateFiles(path.join(options.root, ELECTROBUN_ARTIFACT_DIR), release)
  const target = `stable-${electrobunOs()}-${options.arch}`
  if (process.platform === 'darwin') {
    return [...updateFiles, ...(await packageMacos(options, version, release, target))]
  }
  const platform: ReleasePlatform = process.platform === 'win32' ? 'windows' : 'linux'
  const packaged =
    platform === 'windows'
      ? packageWindows(options, version, release)
      : packageLinux(options, version, release)
  return [...updateFiles, ...packaged, ...writeTransitionMetadata(options.root, release, platform)]
}

function parseCli(argv: readonly string[]): PackageOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      'stand-in': { type: 'boolean', default: false },
      'allow-missing-resources': { type: 'boolean', default: false },
      arch: { type: 'string', default: process.arch },
      webview2: { type: 'string' },
      requirement: { type: 'string' },
      makensis: { type: 'string' },
      appimagetool: { type: 'string' },
    },
  })
  return {
    root: process.cwd(),
    arch: values.arch,
    standIn: values['stand-in'],
    allowMissingResources: values['allow-missing-resources'],
    webview2: values.webview2 ?? null,
    requirement: values.requirement ?? null,
    makensis: values.makensis ?? null,
    appimagetool: values.appimagetool ?? null,
    environment: process.env,
  }
}

function isReleasePlatform(value: string | undefined): value is ReleasePlatform {
  return value === 'mac' || value === 'windows' || value === 'linux'
}

async function main(argv: readonly string[]) {
  if (argv[0] === 'metadata') {
    const [, directory, platform] = argv
    if (directory === undefined || !isReleasePlatform(platform)) {
      throw new Error('Usage: package.ts metadata <release dir> <mac|windows|linux>')
    }
    return writeTransitionMetadata(process.cwd(), path.resolve(directory), platform)
  }
  return packageElectrobunApp(parseCli(argv))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(FIRST_CLI_ARGUMENT)).then(
    (files) => console.log(files.join('\n')),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    },
  )
}
