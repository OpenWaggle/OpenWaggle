/**
 * The Electrobun main-process entry Hutch bundles into `app/bun/index.js` (ADR 0064). Electrobun
 * runs it in a Worker of the launcher's Bun process. It stays thin on purpose: OpenWaggle's main
 * process is built by its own `bun build` (`out/main`, shipped as `app/out/main`) with the
 * Electrobun SDK bundled in, so this file imports `boot.js` by a computed path that Hutch's bundler
 * does not follow. Bundling the main graph here would ship it, and the SDK, twice.
 *
 * Before that it marks the process as the desktop app (src/main/adapters/electrobun/electrobun-sdk.ts:
 * only the desktop app loads the SDK; the Session Host and the CLI are plain `bun` processes), and
 * on Windows makes sure the WebView2 runtime exists, because Electrobun's native webviews only log
 * an error without it. The app ships Microsoft's Evergreen bootstrapper (`resources/webview2/`,
 * vendor/electrobun/sources.ts); it runs once, silently, when neither the per-machine nor the
 * per-user runtime is installed. Windows 11 and most Windows 10 machines already have it, so the
 * check costs three directory lookups.
 *
 * A dev build (`electrobun dev`) imports the checkout's main build instead of a copy: set
 * OPENWAGGLE_ELECTROBUN_MAIN to its `out/main/boot.js`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const APP_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGED_BOOT_MODULE = path.join(APP_DIRECTORY, 'out', 'main', 'boot.js')
const DESKTOP_APP_MARKER = '__openwaggleElectrobunDesktopApp'
const WEBVIEW2_BOOTSTRAPPER = ['resources', 'webview2', 'MicrosoftEdgeWebview2Setup.exe']
const WEBVIEW2_INSTALL_TIMEOUT_MS = 600_000

function webView2Installed() {
  // Windows' defaults when a caller started the app without these variables: running the
  // bootstrapper for a runtime that is installed blocks the start for minutes.
  const roots = [
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    process.env['ProgramFiles'] ?? 'C:\\Program Files',
    process.env['LOCALAPPDATA'],
  ]
  return roots.some(
    (root) =>
      root !== undefined && existsSync(path.join(root, 'Microsoft', 'EdgeWebView', 'Application')),
  )
}

function ensureWebView2() {
  if (process.platform !== 'win32' || webView2Installed()) return
  const bootstrapper = path.join(APP_DIRECTORY, ...WEBVIEW2_BOOTSTRAPPER)
  if (!existsSync(bootstrapper)) return
  // `/silent /install` installs per machine when it can elevate and per user otherwise.
  spawnSync(bootstrapper, ['/silent', '/install'], {
    stdio: 'ignore',
    timeout: WEBVIEW2_INSTALL_TIMEOUT_MS,
    windowsHide: true,
  })
}

function bootModule() {
  if (existsSync(PACKAGED_BOOT_MODULE)) return PACKAGED_BOOT_MODULE
  const development = process.env['OPENWAGGLE_ELECTROBUN_MAIN']
  if (development !== undefined && development !== '') return path.resolve(development)
  throw new Error(`No main bundle at ${PACKAGED_BOOT_MODULE}; set OPENWAGGLE_ELECTROBUN_MAIN.`)
}

Reflect.set(globalThis, DESKTOP_APP_MARKER, true)
ensureWebView2()
await import(pathToFileURL(bootModule()).href)
