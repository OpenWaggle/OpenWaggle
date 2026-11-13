/**
 * Small native calls Electrobun has no API for (ADR 0064 "native helpers"), made through
 * `bun:ffi` against system libraries the OS always has. They run only in the desktop app, which
 * loads them on first use; every helper is best-effort and reports failure instead of throwing.
 *
 * AppKit must be driven from the main thread, where Electrobun runs its native event loop, while
 * OpenWaggle's code runs in a worker thread. The macOS helpers therefore only send
 * `performSelectorOnMainThread:withObject:waitUntilDone:` with an object argument, which is safe
 * from any thread, or call functions documented as thread-safe.
 */
import type * as BunFfi from 'bun:ffi'
import type { Pointer } from 'bun:ffi'
import { createLogger } from '../../logger'

const logger = createLogger('electrobun/native')

type Ffi = typeof BunFfi

interface MacOsRuntime {
  readonly ffi: Ffi
  readonly getClass: (name: string) => Pointer | null
  readonly selector: (name: string) => Pointer | null
  readonly send: (receiver: Pointer | null, selector: Pointer | null) => Pointer | null
  readonly sendWithPointer: (
    receiver: Pointer | null,
    selector: Pointer | null,
    argument: Pointer | null,
  ) => Pointer | null
  readonly sendOnMainThread: (
    receiver: Pointer | null,
    selector: Pointer | null,
    argument: Pointer | null,
  ) => void
  readonly beep: () => void
}

const LIBOBJC = '/usr/lib/libobjc.A.dylib'
const APPKIT = '/System/Library/Frameworks/AppKit.framework/AppKit'
const NUL = '\0'

let ffiModule: Promise<Ffi> | null = null
let macOsRuntime: Promise<MacOsRuntime> | null = null

function loadFfi() {
  ffiModule ??= import('bun:ffi')
  return ffiModule
}

function cString(ffi: Ffi, text: string) {
  return ffi.ptr(Buffer.from(`${text}${NUL}`, 'utf8'))
}

async function createMacOsRuntime() {
  const ffi = await loadFfi()
  const objc = ffi.dlopen(LIBOBJC, {
    objc_getClass: { args: ['ptr'], returns: 'ptr' },
    sel_registerName: { args: ['ptr'], returns: 'ptr' },
    objc_msgSend: { args: ['ptr', 'ptr'], returns: 'ptr' },
  })
  // objc_msgSend takes the method's own signature, so each shape is bound on its own.
  const withPointer = ffi.dlopen(LIBOBJC, {
    objc_msgSend: { args: ['ptr', 'ptr', 'ptr'], returns: 'ptr' },
  })
  const onMainThread = ffi.dlopen(LIBOBJC, {
    objc_msgSend: { args: ['ptr', 'ptr', 'ptr', 'ptr', 'bool'], returns: 'void' },
  })
  const appKit = ffi.dlopen(APPKIT, { NSBeep: { args: [], returns: 'void' } })
  const performOnMainThread = objc.symbols.sel_registerName(
    cString(ffi, 'performSelectorOnMainThread:withObject:waitUntilDone:'),
  )
  return {
    ffi,
    getClass: (name) => objc.symbols.objc_getClass(cString(ffi, name)),
    selector: (name) => objc.symbols.sel_registerName(cString(ffi, name)),
    send: (receiver, selector) => objc.symbols.objc_msgSend(receiver, selector),
    sendWithPointer: (receiver, selector, argument) =>
      withPointer.symbols.objc_msgSend(receiver, selector, argument),
    sendOnMainThread: (receiver, selector, argument) =>
      onMainThread.symbols.objc_msgSend(receiver, performOnMainThread, selector, argument, false),
    beep: () => appKit.symbols.NSBeep(),
  } satisfies MacOsRuntime
}

function macOs() {
  macOsRuntime ??= createMacOsRuntime()
  return macOsRuntime
}

function nsString(runtime: MacOsRuntime, text: string) {
  return runtime.sendWithPointer(
    runtime.getClass('NSString'),
    runtime.selector('stringWithUTF8String:'),
    cString(runtime.ffi, text),
  )
}

function reportFailure(helper: string) {
  return (error: unknown) => {
    logger.warn('Native helper failed', { helper, error: String(error) })
  }
}

/** The Dock badge (macOS): the count, or none for zero. */
export function setMacOsDockBadge(count: number) {
  void macOs()
    .then((runtime) => {
      const application = runtime.send(
        runtime.getClass('NSApplication'),
        runtime.selector('sharedApplication'),
      )
      const dockTile = runtime.send(application, runtime.selector('dockTile'))
      const label = count > 0 ? nsString(runtime, String(count)) : null
      runtime.sendOnMainThread(dockTile, runtime.selector('setBadgeLabel:'), label)
    })
    .catch(reportFailure('dock-badge'))
}

/** The Dock icon of an unpackaged build (macOS), which has no bundle icon of its own. */
export function setMacOsDockIcon(iconPath: string) {
  void macOs()
    .then((runtime) => {
      const allocated = runtime.send(runtime.getClass('NSImage'), runtime.selector('alloc'))
      const image = runtime.sendWithPointer(
        allocated,
        runtime.selector('initWithContentsOfFile:'),
        nsString(runtime, iconPath),
      )
      if (image === null) throw new Error(`No image at ${iconPath}`)
      const application = runtime.send(
        runtime.getClass('NSApplication'),
        runtime.selector('sharedApplication'),
      )
      runtime.sendOnMainThread(application, runtime.selector('setApplicationIconImage:'), image)
    })
    .catch(reportFailure('dock-icon'))
}

const WINDOWS_DEFAULT_BEEP = 0

/** The system alert sound. Linux has no portable one without a display connection. */
export function systemBeep() {
  if (process.platform === 'darwin') {
    void macOs()
      .then((runtime) => runtime.beep())
      .catch(reportFailure('beep'))
    return
  }
  if (process.platform === 'win32') {
    void loadFfi()
      .then((ffi) => {
        const user32 = ffi.dlopen('user32.dll', { MessageBeep: { args: ['u32'], returns: 'i32' } })
        user32.symbols.MessageBeep(WINDOWS_DEFAULT_BEEP)
        user32.close()
      })
      .catch(reportFailure('beep'))
  }
}
