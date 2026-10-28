/**
 * Which external packages the built main bundle loads while it starts, measured by running it.
 *
 * `topLevelRequires` (main-bundle-requires.ts) only checks where a `require()` sits in the file:
 * every function body counts as deferred. But Rolldown's lazy stand-ins are `__commonJSMin`
 * wrappers invoked from `__esmMin` initializers, and nearly every initializer still runs at startup
 * (MEMORY "What every process pays"), so a package imported by a module whose init runs at startup
 * loads at startup although its `require()` sits in a function. This probe evaluates the bundle in
 * Node with every external replaced by a stub that records it, for the argument vectors of the
 * processes that start most often, and reports what was required before the bundle returned.
 * Async work after startup (a Run, an opened window) is not counted; it loads on use by design.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** External packages the main bundle may load while it starts. Node built-ins always may. */
export const ALLOWED_STARTUP_EXTERNALS: readonly string[] = ['electron']

/**
 * The processes probed: a CLI answer, `openwaggle run`, `host start` and the Session Host itself.
 * The desktop app's own start needs a real Electron; its bundle initialization is the same.
 */
export const STARTUP_PROBE_ARGUMENTS: readonly (readonly string[])[] = [
  ['--version'],
  ['run', 'probe'],
  ['host', 'start'],
  ['session-host-internal'],
]

/** Electron's main-process exports, so `__toESM(require('electron'))` gets every name. */
const ELECTRON_EXPORTS = [
  'BaseWindow', 'BrowserView', 'BrowserWindow', 'ImageView', 'IpcMainServiceWorker', 'Menu', 'MenuItem',
  'MessageChannelMain', 'Notification', 'ShareMenu', 'TouchBar', 'Tray', 'View', 'WebContentsView',
  'WebSocket', 'app', 'autoUpdater', 'contentTracing', 'desktopCapturer', 'dialog', 'globalShortcut',
  'inAppPurchase', 'ipcMain', 'nativeTheme', 'net', 'netLog', 'powerMonitor', 'powerSaveBlocker',
  'protocol', 'pushNotifications', 'safeStorage', 'screen', 'session', 'systemPreferences',
  'utilityProcess', 'webContents', 'webFrameMain', 'clipboard', 'crashReporter', 'nativeImage', 'shell',
]

/** Runs as `node -e PROBE_SOURCE <bundle> <electron exports JSON> ...argv`. */
const PROBE_SOURCE = String.raw`
const Module = require('node:module')
const path = require('node:path')
const [bundle, electronExports, ...argv] = process.argv.slice(1)
const ELECTRON_KEYS = JSON.parse(electronExports)
const loaded = []
const value = new Proxy(function () {}, {
  get(_target, key) {
    if (key === 'then') return undefined
    if (key === Symbol.toPrimitive) return () => ''
    if (key === Symbol.iterator) return function* () {}
    return value
  },
  apply: () => value,
  construct: () => value,
})
function moduleStub(keys) {
  return new Proxy({}, {
    get: (_target, key) => (key === 'then' || key === '__esModule' ? undefined : value),
    ownKeys: () => keys,
    getOwnPropertyDescriptor: (_target, key) =>
      keys.includes(key) ? { configurable: true, enumerable: true, writable: true, value } : undefined,
  })
}
const load = Module._load
Module._load = function (request) {
  if (request.startsWith('node:') || Module.builtinModules.includes(request)) return load.apply(this, arguments)
  if (request.startsWith('.') || path.isAbsolute(request)) return load.apply(this, arguments)
  const name = request.startsWith('@') ? request.split('/').slice(0, 2).join('/') : request.split('/')[0]
  if (!loaded.includes(name)) loaded.push(name)
  return moduleStub(name === 'electron' ? ELECTRON_KEYS : [])
}
process.resourcesPath = path.dirname(bundle)
process.argv = [process.argv[0], bundle, ...argv]
let error = null
try {
  require(bundle)
} catch (thrown) {
  error = String((thrown && thrown.stack) || thrown).slice(0, 1000)
}
process.stdout.write(JSON.stringify({ loaded, error }) + '\n')
process.exit(0)
`

export interface StartupProbeResult {
  readonly argv: readonly string[]
  /** External packages, in the order the bundle first required them. */
  readonly loaded: readonly string[]
  /** Whatever the bundle threw while it started under the stubs, if anything. */
  readonly error: string | null
}

const PROBE_TIMEOUT_MS = 60_000
const PROBE_MAX_BUFFER_BYTES = 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Evaluates `bundlePath` once per argument vector, in a throwaway HOME, and reports its loads. */
export function probeStartupExternals(
  bundlePath: string,
  argumentVectors: readonly (readonly string[])[] = STARTUP_PROBE_ARGUMENTS,
): StartupProbeResult[] {
  const home = mkdtempSync(path.join(tmpdir(), 'main-bundle-startup-'))
  try {
    return argumentVectors.map((argv) => {
      const output = execFileSync(
        process.execPath,
        ['-e', PROBE_SOURCE, path.resolve(bundlePath), JSON.stringify(ELECTRON_EXPORTS), ...argv],
        {
          encoding: 'utf8',
          env: { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home, TMPDIR: home },
          timeout: PROBE_TIMEOUT_MS,
          maxBuffer: PROBE_MAX_BUFFER_BYTES,
        },
      )
      const line = output.trim().split('\n').at(-1) ?? ''
      const parsed: unknown = JSON.parse(line)
      if (!isRecord(parsed) || !Array.isArray(parsed.loaded)) throw new Error(`The startup probe printed ${line}.`)
      return {
        argv,
        loaded: parsed.loaded.filter((entry): entry is string => typeof entry === 'string'),
        error: typeof parsed.error === 'string' ? parsed.error : null,
      }
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

/**
 * Failures for `check:main-bundle`: a package outside the allowlist loaded at startup, or a start
 * that threw, since a start cut short could hide later loads.
 */
export function startupExternalFailures(
  results: readonly StartupProbeResult[],
  allowed: readonly string[] = ALLOWED_STARTUP_EXTERNALS,
) {
  return results.flatMap((result) => {
    const command = `\`${['openwaggle', ...result.argv].join(' ')}\``
    const unexpected = result.loaded.filter((name) => !allowed.includes(name))
    return [
      ...(unexpected.length > 0
        ? [
            `${command} loads ${unexpected.join(', ')} while the main bundle starts; import them where they are used ` +
              '(a module whose initializer runs at startup loads its imports then).',
          ]
        : []),
      ...(result.error ? [`${command} threw while the main bundle started under the probe: ${result.error}`] : []),
    ]
  })
}
