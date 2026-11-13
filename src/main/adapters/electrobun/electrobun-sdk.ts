import type * as ElectrobunMain from 'electrobun/main'
import type { electrobunEventEmitter } from 'electrobun/main/events'

/**
 * The Electrobun main-process SDK (`electrobun/main`, bundled from the Hutch devkit), with the
 * event emitter its app-level events (`before-quit`, `open-url`, `reopen`, window focus) go
 * through; `app.on` hands listeners only the event data, so a veto needs the emitter.
 */
export type ElectrobunSdk = typeof ElectrobunMain & {
  readonly events: typeof electrobunEventEmitter
}

/**
 * Global marker the Hutch entry sets before it loads the main bundle: this process runs inside
 * Electrobun's launcher, with its native event loop on the main thread. The headless Session
 * Host and the CLI are plain `bun` processes without it.
 */
const DESKTOP_APP_MARKER = '__openwaggleElectrobunDesktopApp'

let loaded: ElectrobunSdk | null = null
const onLoad: ((sdk: ElectrobunSdk) => void)[] = []

/** Whether this process is the Electrobun desktop app, which alone may load the SDK. */
export function isElectrobunDesktopApp() {
  return Reflect.get(globalThis, DESKTOP_APP_MARKER) === true
}

/**
 * Loads the SDK once. Loading it opens Electrobun's native core library and installs its
 * callbacks, so only the desktop app process does it, at startup (`whenReady`); the Session Host
 * and every CLI call never evaluate it. The main bundle keeps it behind this `import()`, which
 * the bundler turns into a lazy module initializer.
 */
export async function loadElectrobun() {
  if (loaded === null) {
    const [main, events] = await Promise.all([
      import('electrobun/main'),
      import('electrobun/main/events'),
    ])
    const sdk: ElectrobunSdk = { ...main, events: events.electrobunEventEmitter }
    loaded = sdk
    for (const callback of onLoad.splice(0)) callback(sdk)
  }
  return loaded
}

/**
 * Runs `callback` with the SDK once it is loaded (now, if it is). Adapters subscribe to the SDK's
 * events through it, so a listener registered during startup sees the events from the first one.
 */
export function whenElectrobunLoaded(callback: (sdk: ElectrobunSdk) => void) {
  if (loaded) callback(loaded)
  else onLoad.push(callback)
}

/** The loaded SDK, for synchronous port members; it fails loudly before `loadElectrobun()`. */
export function electrobun() {
  if (loaded === null) {
    throw new Error('The Electrobun SDK is only available in the desktop app, once it is ready.')
  }
  return loaded
}

/** The loaded SDK, or null where this process has none (Session Host, CLI, before ready). */
export function loadedElectrobun() {
  return loaded
}
