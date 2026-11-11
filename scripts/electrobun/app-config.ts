/**
 * The product's Electrobun build configuration (ADR 0064, "Electrobun shell"), as a pure function of
 * the build environment so it can be tested; the root `electrobun.config.ts` only calls it. Hutch
 * reads that file when `bun scripts/electrobun/package.ts` (or `bunx electrobun build`) runs.
 *
 * - Identity comes from the Build identity (scripts/build-identity.ts, ADR 0032): every release
 *   channel ships as `com.openwaggle.app` and differs only in display name and icon.
 * - Every release channel builds with Electrobun's `stable` build environment. Electrobun names the
 *   install root (`<appData>/<identifier>/<environment>/app`), its uninstall entry and its bundle
 *   after the environment (`canary` adds `-canary` to every file name), so one environment keeps one
 *   install per machine across channel switches, as Electron's shared identity does. OpenWaggle
 *   chooses the release a channel follows itself (src/main/update-feed.ts); see
 *   docs/release-and-versioning.md, "Electrobun updates".
 * - The app renders in the system webview on macOS and Windows and bundles CEF for the browser
 *   preview, which needs the Chrome DevTools Protocol. A Linux process cannot mix CEF and WebKitGTK
 *   views, so Linux renders everything with CEF.
 * - The main process is OpenWaggle's own `bun build` output (`out/main`, scripts/build-main.ts).
 *   Hutch bundles only the thin entry (scripts/electrobun/hutch-entry.ts), which imports
 *   `app/out/main/boot.js` by a computed path, so the main graph and its Electrobun SDK are bundled
 *   once, by the main build. The stage directory (scripts/electrobun/stage.ts) holds everything
 *   else the app ships: the main bundle, the renderer, the production `node_modules` with the
 *   native modules, and the resources electron-builder shipped as `extraResources`.
 */
import type { ElectrobunConfig } from 'electrobun'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  resolveBuildIdentity,
  resolveIconBasePath,
  type ResolvedBuildIdentity,
} from '../build-identity'
import { isRecord } from '../../src/shared/utils/validation'
import { channelClaimsSessionLinks, SESSION_LINK_SCHEME } from '../../src/shared/utils/session-link'

/** Everything Hutch writes lives under `out/` (the repository's `build/` holds build resources). */
export const ELECTROBUN_OUT_DIR = 'out/electrobun'
export const ELECTROBUN_BUILD_DIR = `${ELECTROBUN_OUT_DIR}/build`
export const ELECTROBUN_ARTIFACT_DIR = `${ELECTROBUN_OUT_DIR}/artifacts`
/** What scripts/electrobun/stage.ts prepares for Hutch's `copy`. */
export const ELECTROBUN_STAGE_DIR = `${ELECTROBUN_OUT_DIR}/stage`
/**
 * The unwrapped macOS app the postBuild hook keeps (prepared, signed, stapled), one directory per
 * build: Hutch replaces the build folder's app with its self-extracting wrapper afterwards, and the
 * DMG and the Electron transition zip ship this bundle, the same one the update archive holds.
 */
export const ELECTROBUN_INNER_APP_DIR = `${ELECTROBUN_OUT_DIR}/inner`
/** OpenWaggle's release files: DMG, transition artifacts and their metadata (package.ts). */
export const ELECTROBUN_RELEASE_DIR = `${ELECTROBUN_OUT_DIR}/release`
export const HUTCH_ENTRY = 'scripts/electrobun/hutch-entry.ts'
export const POST_BUILD_HOOK = 'scripts/electrobun/hooks/post-build.ts'
export const POST_WRAP_HOOK = 'scripts/electrobun/hooks/post-wrap.ts'

/**
 * Where OpenWaggle's own files sit inside the packaged `app` directory (Electrobun's
 * `Resources/app`, next to Hutch's `bun/index.js` entry): the same relative paths as in the
 * checkout, so the main bundle finds the renderer and `node_modules` the same way in both. The
 * desktop shell's AppPaths adapter finds the app root by the `package.json` named `openwaggle` and
 * the bundled resources in `resources/`, as Electron's `process.resourcesPath`.
 */
export const PACKAGED_APP_LAYOUT = {
  main: 'out/main',
  preload: 'out/preload',
  renderer: 'out/renderer',
  nodeModules: 'node_modules',
  resources: 'resources',
  packageJson: 'package.json',
} as const

/**
 * The feed an install reads when OpenWaggle has not chosen a release yet. OpenWaggle's updater
 * always points the Electrobun updater at the release it selected before it checks
 * (src/main/adapters/electrobun/electrobun-update-engine.ts), so this only names a sane default:
 * the newest Stable release, which GitHub redirects `latest/download` to.
 */
export const DEFAULT_RELEASE_BASE_URL =
  'https://github.com/OpenWaggle/OpenWaggle/releases/latest/download'

/**
 * The previous release's download directory, from which Hutch builds the delta patch to this one
 * (release.yml sets it to the newest earlier release on the same channel). Without it Hutch builds
 * no patch and every update downloads the full archive.
 */
export const PATCH_BASE_URL_ENV = 'OPENWAGGLE_ELECTROBUN_PATCH_BASE_URL'

export interface ElectrobunConfigInput {
  readonly identity: ResolvedBuildIdentity
  readonly version: string
  readonly environment: NodeJS.ProcessEnv
}

function channelIconPng(identity: ResolvedBuildIdentity) {
  return resolveIconBasePath(identity.channel, 'build')
}

export function electrobunAppConfig(input: ElectrobunConfigInput) {
  const { identity, environment } = input
  const patchBaseUrl = environment[PATCH_BASE_URL_ENV]?.trim() ?? ''
  const stage = ELECTROBUN_STAGE_DIR
  return {
    app: {
      name: identity.productName,
      identifier: identity.appId,
      version: input.version,
      description: 'Desktop coding agent with multi-model support',
      // Session links (`openwaggle://sessions/<id>`, ADR 0056), release channels only. Electrobun
      // writes them to the macOS Info.plist; Windows and Linux register at runtime, as with Electron.
      ...(channelClaimsSessionLinks(identity.channel) ? { urlSchemes: [SESSION_LINK_SCHEME] } : {}),
    },
    build: {
      mainProcess: 'bun',
      bun: { entrypoint: HUTCH_ENTRY },
      copy: {
        [`${stage}/out/main`]: PACKAGED_APP_LAYOUT.main,
        [`${stage}/out/preload`]: PACKAGED_APP_LAYOUT.preload,
        [`${stage}/out/renderer`]: PACKAGED_APP_LAYOUT.renderer,
        [`${stage}/node_modules`]: PACKAGED_APP_LAYOUT.nodeModules,
        [`${stage}/resources`]: PACKAGED_APP_LAYOUT.resources,
        [`${stage}/package.json`]: PACKAGED_APP_LAYOUT.packageJson,
      },
      buildFolder: ELECTROBUN_BUILD_DIR,
      artifactFolder: ELECTROBUN_ARTIFACT_DIR,
      mac: {
        // OpenWaggle signs and notarizes the app itself (scripts/electrobun/sign-macos.ts): the
        // bundled `bun`, where Bun.secrets reads the keychain, must carry the app's identifier, which
        // Hutch's signing does not do (docs/electrobun-transition.md, "macOS keychain").
        codesign: false,
        notarize: false,
        // The DMG holds the signed, unwrapped app (scripts/electrobun/macos-dmg.ts), not Hutch's
        // self-extracting wrapper, so it is the same bundle the transition zip ships.
        createDmg: false,
        // CEF is bundled for the browser preview. A release build opens no DevTools endpoint:
        // Electrobun 2.0.6 enables remote debugging only in `dev` builds or for an explicit port
        // (`chromiumFlags['remote-debugging-port']`, 1-65535, never scanned for a free one), and
        // rejects port 0 as invalid configuration.
        bundleCEF: true,
        defaultRenderer: 'native',
        icons: `${stage}/icon.iconset`,
      },
      win: {
        bundleCEF: true,
        defaultRenderer: 'native',
        icon: identity.channel === 'stable' ? 'build/icon.ico' : channelIconPng(identity),
      },
      linux: {
        bundleCEF: true,
        defaultRenderer: 'cef',
        icon: channelIconPng(identity),
      },
    },
    scripts: {
      postBuild: POST_BUILD_HOOK,
      postWrap: POST_WRAP_HOOK,
    },
    // The desktop shell decides when the app quits (macOS keeps running without windows).
    runtime: { exitOnLastWindowClosed: false },
    release: {
      baseUrl: patchBaseUrl === '' ? DEFAULT_RELEASE_BASE_URL : patchBaseUrl,
      generatePatch: patchBaseUrl !== '',
    },
  } satisfies ElectrobunConfig
}

/** The version in the checkout's `package.json`, which every artifact carries. */
export function packageVersion(root: string) {
  const manifest: unknown = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const version = isRecord(manifest) ? manifest['version'] : null
  if (typeof version !== 'string') throw new Error(`${root}/package.json has no version.`)
  return version
}

/** The configuration for the current build context (the root `electrobun.config.ts`). */
export function currentElectrobunAppConfig(
  environment: NodeJS.ProcessEnv = process.env,
  version: string,
) {
  return electrobunAppConfig({ identity: resolveBuildIdentity(environment), version, environment })
}
