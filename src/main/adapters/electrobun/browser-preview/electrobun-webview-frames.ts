import { createRequire } from 'node:module'
import path from 'node:path'

/**
 * Moves, resizes and hides a native Electrobun webview by id. Electrobun 2.0.6 gives a
 * `BrowserView` no public frame or visibility setter (its `<electrobun-webview>` tag drives them
 * through internal RPC), so this binds the same two functions of Electrobun's native core that
 * the SDK binds (`resizeWebview`, `webviewSetHidden`), loaded from the same place: the working
 * directory or beside the launcher. The signatures are pinned with the SDK (vendor/electrobun);
 * the bench CI run checks the preview moves and hides on every OS.
 */
export interface NativeWebviewFrames {
  readonly setFrame: (
    webviewId: number,
    frame: {
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    },
  ) => void
  readonly setHidden: (webviewId: number, hidden: boolean) => void
}

interface FfiLibrary {
  readonly symbols: Readonly<Record<string, unknown>>
}

interface BunFfi {
  readonly dlopen: (libraryPath: string, symbols: object) => FfiLibrary
  readonly suffix: string
}

const NO_MASKS = new TextEncoder().encode('[]\0')

function isBunFfi(value: unknown): value is BunFfi {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'dlopen') === 'function' &&
    typeof Reflect.get(value, 'suffix') === 'string'
  )
}

type NativeFunction = (...args: readonly unknown[]) => unknown

function isNativeFunction(value: unknown): value is NativeFunction {
  return typeof value === 'function'
}

function coreLibraryName(ffi: BunFfi) {
  return process.platform === 'win32' ? 'ElectrobunCore.dll' : `libElectrobunCore.${ffi.suffix}`
}

function openCore(ffi: BunFfi): FfiLibrary {
  const name = coreLibraryName(ffi)
  const candidates = new Set([path.join(process.cwd(), name)])
  if (process.argv0) candidates.add(path.join(path.dirname(process.argv0), name))
  let lastError: unknown = null
  for (const candidate of candidates) {
    try {
      return ffi.dlopen(candidate, {
        resizeWebview: { args: ['u32', 'f64', 'f64', 'f64', 'f64', 'cstring'], returns: 'void' },
        webviewSetHidden: { args: ['u32', 'bool'], returns: 'void' },
      })
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`Electrobun's native core (${name}) could not be loaded.`, { cause: lastError })
}

/** Binds the native core on first use, so importing this module loads no native code. */
export function electrobunNativeWebviewFrames(): NativeWebviewFrames {
  let bound: { readonly resize: NativeFunction; readonly hide: NativeFunction } | null = null
  const bind = () => {
    if (bound !== null) return bound
    const ffi: unknown = createRequire(import.meta.url)('bun:ffi')
    if (!isBunFfi(ffi)) throw new Error('bun:ffi is not available in this runtime.')
    const core = openCore(ffi)
    const resize = core.symbols['resizeWebview']
    const hide = core.symbols['webviewSetHidden']
    if (!isNativeFunction(resize) || !isNativeFunction(hide)) {
      throw new Error("Electrobun's native core lacks the webview frame functions.")
    }
    bound = { resize, hide }
    return bound
  }
  return {
    setFrame: (webviewId, frame) => {
      bind().resize(webviewId, frame.x, frame.y, frame.width, frame.height, NO_MASKS)
    },
    setHidden: (webviewId, hidden) => {
      bind().hide(webviewId, hidden)
    },
  }
}
