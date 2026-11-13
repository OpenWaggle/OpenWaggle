/**
 * Smokes the packaged Electrobun app (scripts/electrobun/package.ts) the way it ships, before the
 * release uploads it: the files under the app directory (`Contents/Resources/app` on macOS,
 * `Resources/app` elsewhere, scripts/electrobun/app-config.ts `copy`), then two probes run by the
 * app's own bundled Bun: the native load probe against the app's own `node_modules`, and Pi's
 * HTML export and theme loading against the app's copy of Pi's package directory
 * (scripts/pi-package-assets-probe.ts).
 *
 * - The app directory holds exactly Hutch's entry (`bun/`), `out/` (main, preload, renderer, no
 *   source maps), the production `node_modules`, `resources/` and `package.json`; no workspace
 *   sources or tsconfigs, no legacy MCP adapter.
 * - Pi's README, docs and examples ship: Pi names them to the model. So do its HTML export
 *   templates, built-in themes and interactive assets, which it reads from its package directory.
 * - The runtime trim of scripts/electrobun/stage-node-modules.ts held, and did not remove a file
 *   the runtime loads.
 * - The installed docs and the third-party notices ship; the Session embedding model does not.
 *
 * On macOS it reads the signed unwrapped app package.ts keeps; on Windows and Linux it unpacks the
 * payload of Hutch's self-extracting wrapper, the bytes the first launch installs. Apps for another
 * architecture get the file checks only.
 *
 *   bun scripts/packaged-app-smoke.ts [app or wrapper paths...]
 */
import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { electrobunPayloads, extractElectrobunPayload } from './electrobun-payload'
import { listFiles } from './native-floor-layout'
import { discoverElectrobunApps } from './native-platform-floor-targets'

const execFile = promisify(execFileCallback)

type SmokePlatform = 'darwin' | 'linux' | 'win32'

const FIRST_USER_ARGUMENT_INDEX = 2
const ARGUMENT_SEPARATOR = '--'
const PREVIEW_LIMIT = 20
const PROBE_TIMEOUT_MS = 60_000
const EXEC_MAX_BUFFER_BYTES = 10_000_000
const NATIVE_LOAD_PROBE = path.resolve(import.meta.dirname, 'native-load-probe.ts')
const PI_PACKAGE_ASSETS_PROBE = path.resolve(import.meta.dirname, 'pi-package-assets-probe.ts')

const APP_DIRECTORY: Readonly<Record<SmokePlatform, string>> = {
  darwin: 'Contents/Resources/app',
  linux: 'Resources/app',
  win32: 'Resources/app',
}
const BUNDLED_BUN: Readonly<Record<SmokePlatform, string>> = {
  darwin: 'Contents/MacOS/bun',
  linux: 'bin/bun',
  win32: 'bin/bun.exe',
}
const ELECTROBUN_ARCH = /-(arm64|x64)$/u

const REQUIRED_ROOTS = ['bun', 'node_modules', 'out', 'package.json', 'resources'] as const
const ALLOWED_OUT_ROOTS = ['out/main', 'out/preload', 'out/renderer'] as const
const REQUIRED_FILES = [
  'bun/index.js',
  'out/main/boot.js',
  'out/main/index.js',
  'out/preload/electrobun.js',
  'out/renderer/index.html',
  'package.json',
  // Pi resolves its README, docs and examples from its package directory and names them to the model.
  'node_modules/@earendil-works/pi-coding-agent/README.md',
  'node_modules/@earendil-works/pi-coding-agent/docs/codemode.md',
  'node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/template.html',
  'node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json',
  'node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/light.json',
  // Files the runtime loads from the trimmed packages, so the trim cannot remove too much.
  'node_modules/onnxruntime-node/package.json',
  'node_modules/better-sqlite3/lib/index.js',
  // The LSTM cores the attachment parser's engine loads, without SIMD and with relaxed SIMD.
  'node_modules/tesseract.js-core/tesseract-core-lstm.js',
  'node_modules/tesseract.js-core/tesseract-core-lstm.wasm',
  'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.js',
  'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm',
  // Bundled into main, and also resolved from node_modules when the attachment parser loads: a
  // package without them fails to boot (scripts/electrobun/stage-node-modules.ts).
  'node_modules/jszip/package.json',
  'node_modules/mammoth/package.json',
  'node_modules/unpdf/package.json',
  'resources/THIRD_PARTY_NOTICES.md',
  'resources/openwaggle-docs/README.md',
  'resources/openwaggle-docs/index.json',
] as const
const PI_EXAMPLES = 'node_modules/@earendil-works/pi-coding-agent/examples/'

/** Files that must never ship, by what they are. */
const FORBIDDEN_FILES: readonly { readonly label: string; readonly matches: RegExp }[] = [
  { label: 'workspace package sources', matches: /^node_modules\/@openwaggle\/[^/]+\/src\// },
  {
    label: 'workspace package tsconfigs',
    matches: /^node_modules\/@openwaggle\/[^/]+\/tsconfig[^/]*\.json$/,
  },
  // About 135 MB the Host fetches on first use (src/main/adapters/session-embedding-model-files.ts).
  { label: 'the Session embedding model', matches: /^resources\/session-embedding-model\// },
  { label: 'the legacy MCP adapter', matches: /(?:^|\/)node_modules\/pi-mcp-adapter\// },
  // transformers.js's Node build runs inference through onnxruntime-node.
  { label: 'onnxruntime-web', matches: /(?:^|\/)node_modules\/onnxruntime-web\// },
  // The addon loads from `build/Release` or `prebuilds/`.
  {
    label: 'better-sqlite3 sources',
    matches: /(?:^|\/)node_modules\/better-sqlite3\/(?:deps|src)\//,
  },
  // The browser variants with the WASM inlined.
  {
    label: 'tesseract.js-core browser builds',
    matches: /(?:^|\/)node_modules\/tesseract\.js-core\/[^/]+\.wasm\.js$/,
  },
  // The minified bundles' hidden source maps are release artifacts, never app files.
  { label: 'source maps', matches: /^out\/.+\.map$/ },
  {
    label: 'renderer-only packages',
    matches:
      /(?:^|\/)node_modules\/(?:shiki|@shikijs|@pierre\/diffs|lexical|@lexical|@lobehub|@headless-tree|@tanstack\/react-router|@modelcontextprotocol\/ext-apps)\//,
  },
]

function isSmokePlatform(value: string): value is SmokePlatform {
  return value === 'darwin' || value === 'linux' || value === 'win32'
}

/** Every problem with the app directory's files (`/`-separated, relative to the app directory). */
export function packagedAppIssues(files: readonly string[]) {
  const issues: string[] = []
  const roots = new Set(files.map((file) => file.split('/')[0] ?? file))
  for (const root of REQUIRED_ROOTS) if (!roots.has(root)) issues.push(`missing ${root}`)
  for (const root of roots) {
    if (!REQUIRED_ROOTS.some((required) => required === root)) issues.push(`unexpected ${root}`)
  }
  const unexpectedOut = files.filter(
    (file) =>
      file.startsWith('out/') && !ALLOWED_OUT_ROOTS.some((root) => file.startsWith(`${root}/`)),
  )
  if (unexpectedOut.length > 0) {
    issues.push(`unexpected build output ${unexpectedOut.slice(0, PREVIEW_LIMIT).join(', ')}`)
  }
  const shipped = new Set(files)
  for (const file of REQUIRED_FILES) if (!shipped.has(file)) issues.push(`misses ${file}`)
  if (!files.some((file) => file.startsWith(PI_EXAMPLES))) issues.push(`misses ${PI_EXAMPLES}`)
  for (const rule of FORBIDDEN_FILES) {
    const first = files.find((file) => rule.matches.test(file))
    if (first !== undefined) issues.push(`ships ${rule.label} (${first})`)
  }
  return issues
}

/** The architecture in an Electrobun target directory name (`stable-macos-arm64`), if any. */
export function packagedAppArchitecture(appPath: string) {
  return ELECTROBUN_ARCH.exec(path.basename(path.dirname(appPath)))?.[1] ?? null
}

/** The bundled Bun running the native load probe on the app's own `node_modules`. */
export function nativeProbeInvocation(appRoot: string, platform: SmokePlatform) {
  return {
    command: path.join(appRoot, BUNDLED_BUN[platform]),
    args: [NATIVE_LOAD_PROBE, path.join(appRoot, APP_DIRECTORY[platform])],
  }
}

/** The bundled Bun running Pi's HTML export and theme loading on the app's copy of Pi. */
export function piPackageAssetsProbeInvocation(appRoot: string, platform: SmokePlatform) {
  return {
    command: path.join(appRoot, BUNDLED_BUN[platform]),
    args: [PI_PACKAGE_ASSETS_PROBE, path.join(appRoot, APP_DIRECTORY[platform])],
  }
}

async function smokeAppRoot(appRoot: string, platform: SmokePlatform, probe: boolean) {
  const appDirectory = path.join(appRoot, APP_DIRECTORY[platform])
  const files = await listFiles(appDirectory).catch(() => null)
  if (files === null) {
    throw new Error(`${appRoot} has no app directory at ${APP_DIRECTORY[platform]}.`)
  }
  const issues = packagedAppIssues(files)
  if (issues.length > 0) {
    throw new Error(`${appRoot} is not packaged correctly:\n  ${issues.join('\n  ')}`)
  }
  if (!probe) {
    console.log(`packaged app files passed (no native probe for another architecture): ${appRoot}`)
    return false
  }
  for (const invocation of [
    nativeProbeInvocation(appRoot, platform),
    piPackageAssetsProbeInvocation(appRoot, platform),
  ]) {
    await execFile(invocation.command, invocation.args, {
      maxBuffer: EXEC_MAX_BUFFER_BYTES,
      timeout: PROBE_TIMEOUT_MS,
    })
  }
  console.log(`packaged app smoke passed: ${appRoot}`)
  return true
}

/** Smokes an unwrapped app, or each app in the payloads of a wrapper. */
async function smokePackagedApp(appPath: string, platform: SmokePlatform) {
  const architecture = packagedAppArchitecture(appPath)
  const probe = architecture === null || architecture === process.arch
  const payloads = await electrobunPayloads(appPath, platform)
  if (payloads.length === 0) return [await smokeAppRoot(appPath, platform, probe)]
  const results: boolean[] = []
  for (const payload of payloads) {
    const { directory, roots } = await extractElectrobunPayload(payload)
    try {
      if (roots.length === 0) throw new Error(`${payload} contains no app.`)
      for (const root of roots) results.push(await smokeAppRoot(root, platform, probe))
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
  return results
}

async function main() {
  const platform = process.platform
  if (!isSmokePlatform(platform)) throw new Error(`No packaged app smoke for ${platform}.`)
  const explicit = process.argv
    .slice(FIRST_USER_ARGUMENT_INDEX)
    .filter((argument) => argument !== ARGUMENT_SEPARATOR)
    .map((appPath) => path.resolve(appPath))
  const appPaths = explicit.length > 0 ? explicit : await discoverElectrobunApps(platform)
  const probed: boolean[] = []
  for (const appPath of appPaths) probed.push(...(await smokePackagedApp(appPath, platform)))
  if (!probed.includes(true)) {
    throw new Error('No packaged app matched the host architecture for the native load probe.')
  }
  console.log(`packaged app smoke passed: ${appPaths.length} app(s)`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
