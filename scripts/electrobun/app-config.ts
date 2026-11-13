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
 * - The app renders in the system webview on macOS and Windows. The browser preview needs Chromium
 *   pages it drives over the Chrome DevTools Protocol: macOS bundles CEF for them; Windows bundles
 *   none and gets them from WebView2's separate Chromium environment (vendor/electrobun patch 0013),
 *   which serves DevTools on a per-launch loopback port and starts with the first preview. A Linux
 *   process cannot mix CEF and WebKitGTK views, so Linux renders everything with CEF.
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
 * The Windows icon of a channel without an `.ico`, staged at 256 px (stage.ts): Hutch embeds a PNG
 * icon only up to the largest ICO entry and fails on the 512 px channel icons (`PngTooLarge`).
 */
export const WINDOWS_ICON_PNG = 'icon-windows.png'
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

/** Where GitHub serves each release's files, one directory per tag. */
export const RELEASE_DOWNLOAD_BASE = 'https://github.com/OpenWaggle/OpenWaggle/releases/download'

/**
 * The release directory baked into the bundle (`Resources/version.json` `baseUrl`). OpenWaggle's
 * updater points the Electrobun updater at the release it selected before every check
 * (src/main/adapters/electrobun/electrobun-update-engine.ts), and Electrobun's native prepare
 * accepts that release only from this directory or a sibling of it (vendor patch 0011): another
 * tag's directory beside it. By default it is this version's own release directory.
 */
export function ownReleaseBaseUrl(version: string) {
  return `${RELEASE_DOWNLOAD_BASE}/${encodeURIComponent(`v${version}`)}`
}

/**
 * This build's release directory when it is not served from GitHub, such as a loopback feed in a
 * CI update proof (`http://127.0.0.1:<port>/current`); its updates come from sibling directories.
 */
export const RELEASE_BASE_URL_ENV = 'OPENWAGGLE_ELECTROBUN_RELEASE_BASE_URL'

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

/**
 * CEF's command line in every build that bundles it. `remote-debugging-port: 'launch'` asks the
 * launcher for a free loopback DevTools port per launch (vendor/electrobun patch 0007), which the
 * browser preview's CDP client needs; without it a release build serves no endpoint and only QA,
 * which sets the port itself, could drive previews. `false` drops a default Electrobun sets:
 * `remote-allow-origins=*` would let any web page open the DevTools WebSocket and drive every CEF
 * page (cef-devtools-endpoint.ts), `allow-insecure-localhost` accepts bad certificates on
 * localhost, and `disable-web-security` (Linux, where CEF also renders the app) turns the
 * same-origin policy off. On Linux the endpoint also lists the app's own window, so any process of
 * the user can drive it; macOS and Windows keep the app window out of it.
 */
export const CEF_CHROMIUM_FLAGS: Readonly<Record<string, string | boolean>> = {
  'remote-debugging-port': 'launch',
  'remote-allow-origins': false,
  'allow-insecure-localhost': false,
  'disable-web-security': false,
}

/**
 * Linux's CEF command line: CEF_CHROMIUM_FLAGS, fewer Chromium processes, and no secret portal key
 * provider.
 *
 * Every CEF process maps libcef.so and its own allocator and IPC state, so each helper costs tens
 * of MiB of resident memory. With software compositing (Electrobun's Linux defaults turn the GPU
 * off) the GPU process only rasterizes, and the network service only serves the app's loopback
 * pages and the previews: both run in the browser process (`in-process-gpu`,
 * `NetworkServiceInProcess`); the two helpers held about 240 MiB. The audio service runs in the browser process too (`AudioServiceOutOfProcess` off):
 * the out-of-process one started with the first sound of a turn and stayed, about 90 MiB. No spare
 * renderer is kept warm for the next site (`SpareRendererForSitePerProcess` off): the app has one
 * window and a preview opens rarely, so the spare, about 90 MiB, waited for nothing.
 *
 * `DbusSecretPortal` off: at startup Chromium asks the desktop portal (`org.freedesktop.portal.Secret`
 * RetrieveSecret) for its cookie encryption key and holds the first page load until the answer
 * comes, so a portal that is activatable but never answers (a session without a working
 * xdg-desktop-portal) kept the window blank for D-Bus's 25 s reply timeout. Chromium then uses its
 * other Linux key providers (the Secret Service keyring, else its basic key), as it does when the
 * portal has no Secret interface. The package proof runs on a session bus whose portal never
 * answers (electrobun-package.yml).
 */
export const LINUX_CEF_CHROMIUM_FLAGS: Readonly<Record<string, string | boolean>> = {
  ...CEF_CHROMIUM_FLAGS,
  'in-process-gpu': true,
  'enable-features': 'NetworkServiceInProcess',
  'disable-features': 'DbusSecretPortal,AudioServiceOutOfProcess,SpareRendererForSitePerProcess',
}

export function electrobunAppConfig(input: ElectrobunConfigInput) {
  const { identity, environment } = input
  const patchBaseUrl = environment[PATCH_BASE_URL_ENV]?.trim() ?? ''
  const releaseBaseUrl =
    environment[RELEASE_BASE_URL_ENV]?.trim() || ownReleaseBaseUrl(input.version)
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
        // CEF is bundled for the browser preview, and serves DevTools on a per-launch loopback
        // port only (CEF_CHROMIUM_FLAGS).
        bundleCEF: true,
        chromiumFlags: CEF_CHROMIUM_FLAGS,
        defaultRenderer: 'native',
        icons: `${stage}/icon.iconset`,
      },
      win: {
        // No CEF (vendor/electrobun patch 0013): the preview's `renderer: 'cef'` views open in
        // WebView2's Chromium environment, the only one on the DevTools port, which the launcher
        // picks per launch (patch 0007). The main window's environment never serves DevTools.
        bundleCEF: false,
        chromiumFlags: { 'remote-debugging-port': 'launch' },
        defaultRenderer: 'native',
        icon: identity.channel === 'stable' ? 'build/icon.ico' : `${stage}/${WINDOWS_ICON_PNG}`,
      },
      linux: {
        bundleCEF: true,
        chromiumFlags: LINUX_CEF_CHROMIUM_FLAGS,
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
      // The earlier release a patch is built against is a sibling directory too.
      baseUrl: patchBaseUrl === '' ? releaseBaseUrl : patchBaseUrl,
      generatePatch: patchBaseUrl !== '',
    },
  } satisfies ElectrobunConfig
}

/** The version in the checkout's `package.json`, which every artifact carries. */
export function packageVersion(root: string) {
  const manifest: unknown = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const version = isRecord(manifest) ? manifest.version : null
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
