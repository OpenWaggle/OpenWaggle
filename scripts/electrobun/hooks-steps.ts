/**
 * What OpenWaggle's Electrobun build hooks do (scripts/electrobun/hooks/). Hutch runs a hook by
 * importing its file with the hook environment (`ELECTROBUN_OS`, `ELECTROBUN_BUILD_ENV`,
 * `ELECTROBUN_BUILD_DIR`, `ELECTROBUN_WRAPPER_BUNDLE_PATH`, `ELECTROBUN_APP_IDENTIFIER`, …), so the
 * hook files only call these functions.
 *
 * postBuild sees the unwrapped app before Hutch compresses it into the update archive and the
 * self-extracting payload, so everything that must be in every copy of the app happens here:
 * - macOS: the launch version (`LSMinimumSystemVersion`), the bundle preparation the Electron
 *   transition needs (scripts/electrobun-transition/macos-transition-bundle.ts), then, when an
 *   identity is configured, signing inside out (ad hoc without one). Hutch rewrites `version.json`
 *   after this hook, so package.ts re-seals, notarizes and repacks the app afterwards
 *   (macos-reseal.ts);
 * - Windows: Authenticode signing of every PE file, when a certificate is configured.
 * - Linux: the CEF files Chromium never loads go (linux-cef-prune.ts).
 * postWrap sees Hutch's wrapper: the macOS wrapper gets the launch version, the Windows Setup
 * executable is signed.
 *
 * Signing configuration, all optional (macOS builds are then signed ad hoc, Windows ones unsigned):
 * - OPENWAGGLE_MACOS_SIGN_IDENTITY, OPENWAGGLE_MACOS_SIGN_KEYCHAIN,
 *   OPENWAGGLE_MACOS_SIGN_TIMESTAMP=0 (self-signed CI identities), plus APPLE_ID,
 *   APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID to notarize;
 * - OPENWAGGLE_WINDOWS_SIGN_PFX, OPENWAGGLE_WINDOWS_SIGN_PASSWORD,
 *   OPENWAGGLE_WINDOWS_SIGN_TIMESTAMP_URL.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { applyLaunchVersion } from '../electrobun-macos-launch-version'
import { prepareMacosTransitionBundle } from '../electrobun-transition/macos-transition-bundle'
import { promisify } from 'node:util'
import { ELECTROBUN_INNER_APP_DIR } from './app-config'
import { pruneLinuxCef } from './linux-cef-prune'
import { ELECTROBUN_ENTITLEMENTS, signMacosApp } from './sign-macos'
import { signWindowsBinaries } from './sign-windows'

const run = promisify(execFile)
const APP_SUFFIX = '.app'

/** Keeps the finished unwrapped app (app-config.ts, ELECTROBUN_INNER_APP_DIR), signatures intact. */
async function keepInnerApp(app: string, buildDirectory: string) {
  const destination = path.resolve(ELECTROBUN_INNER_APP_DIR, path.basename(buildDirectory))
  await fs.rm(destination, { recursive: true, force: true })
  await fs.mkdir(destination, { recursive: true })
  await run('ditto', [app, path.join(destination, path.basename(app))])
  return `kept ${path.join(destination, path.basename(app))}`
}

async function appBundles(directory: string) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(APP_SUFFIX))
    .map((entry) => path.join(directory, entry.name))
}

function required(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name]
  if (value === undefined || value === '') throw new Error(`The Electrobun hook needs ${name}.`)
  return value
}

/** Ad-hoc signature: seals an unsigned build so it verifies and launches on Apple silicon. */
const AD_HOC_IDENTITY = '-'

async function prepareMacosApp(app: string, environment: NodeJS.ProcessEnv) {
  const bundleId = required(environment, 'ELECTROBUN_APP_IDENTIFIER')
  await prepareMacosTransitionBundle({ app, bundleId })
  const configured = environment.OPENWAGGLE_MACOS_SIGN_IDENTITY ?? ''
  const identity = configured === '' ? AD_HOC_IDENTITY : configured
  const keychain = environment.OPENWAGGLE_MACOS_SIGN_KEYCHAIN ?? ''
  await signMacosApp({
    app,
    identity,
    bundleId,
    entitlements: path.resolve(ELECTROBUN_ENTITLEMENTS),
    timestamp: identity !== AD_HOC_IDENTITY && environment.OPENWAGGLE_MACOS_SIGN_TIMESTAMP !== '0',
    ...(keychain === '' ? {} : { keychain }),
  })
  return `${app}: ${identity === AD_HOC_IDENTITY ? 'ad-hoc signed' : 'signed'}`
}

async function signWindows(targets: readonly string[], environment: NodeJS.ProcessEnv) {
  const pfx = environment.OPENWAGGLE_WINDOWS_SIGN_PFX ?? ''
  if (pfx === '' || environment.ELECTROBUN_BUILD_ENV === 'dev') return ['Windows: unsigned']
  const timestampUrl = environment.OPENWAGGLE_WINDOWS_SIGN_TIMESTAMP_URL ?? ''
  const signed = await signWindowsBinaries({
    targets,
    pfx,
    password: environment.OPENWAGGLE_WINDOWS_SIGN_PASSWORD ?? '',
    timestampUrl: timestampUrl === '' ? null : timestampUrl,
  })
  return signed.map((file) => `signed ${file}`)
}

export async function electrobunPostBuild(environment: NodeJS.ProcessEnv) {
  const buildDirectory = required(environment, 'ELECTROBUN_BUILD_DIR')
  const os = environment.ELECTROBUN_OS
  if (os === 'macos') {
    const applied = await applyLaunchVersion(environment)
    const prepared: string[] = []
    for (const app of await appBundles(buildDirectory)) {
      prepared.push(
        await prepareMacosApp(app, environment),
        await keepInnerApp(app, buildDirectory),
      )
    }
    return [...applied.map((bundle) => `launch version: ${bundle}`), ...prepared]
  }
  if (os === 'win') return signWindows([buildDirectory], environment)
  if (os === 'linux') {
    const { removed, stripped } = await pruneLinuxCef(buildDirectory)
    return [
      `removed ${String(removed.length)} unused CEF files (linux-cef-prune.ts)`,
      ...stripped.map((file) => `stripped ${file}`),
    ]
  }
  return []
}

export async function electrobunPostWrap(environment: NodeJS.ProcessEnv) {
  const os = environment.ELECTROBUN_OS
  if (os === 'macos') {
    const applied = await applyLaunchVersion(environment)
    return applied.map((bundle) => `launch version: ${bundle}`)
  }
  const wrapper = environment.ELECTROBUN_WRAPPER_BUNDLE_PATH ?? ''
  if (os === 'win' && wrapper !== '') return signWindows([wrapper], environment)
  return []
}
