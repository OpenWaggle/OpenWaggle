/**
 * The process state a reused Vitest worker started with, and how to put it back before the next
 * file (`reused-worker-isolation.ts`): env, working directory, timers, process listeners, globals,
 * and the builtins and global classes code patches in place.
 */
import type { EventEmitter } from 'node:events'
import { trackDomListeners } from './dom-listener-tracking'

interface ObjectSnapshot {
  readonly target: object
  readonly descriptors: ReadonlyMap<PropertyKey, PropertyDescriptor>
}

export interface WorkerProcessBaseline {
  readonly brand: typeof BASELINE_BRAND
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd: string
  readonly globals: ObjectSnapshot
  readonly listeners: ReadonlyMap<string | symbol, readonly unknown[]>
  /** Restored in full: keys added since are deleted. */
  readonly owned: readonly ObjectSnapshot[]
  /** Global classes and their prototypes: changed keys are restored, added ones kept. */
  readonly shared: readonly ObjectSnapshot[]
  /** Timers a file left pending, which a fresh worker would never have run. */
  readonly timers: Map<unknown, (handle: unknown) => void>
  /** Removes the listeners a file left on the window or document; a fresh jsdom has none. */
  readonly clearDomListeners: () => void
}

const BASELINE_BRAND = Symbol.for('openwaggle.test.worker-process-baseline')

/** Builtins that code patches in place, and whose exported classes' prototypes it patches. */
const PATCHED_BUILTINS = [
  'node:child_process',
  'node:dgram',
  'node:dns',
  'node:dns/promises',
  'node:events',
  'node:fs',
  'node:fs/promises',
  'node:http',
  'node:http2',
  'node:https',
  'node:module',
  'node:net',
  'node:stream',
  'node:timers',
  'node:tls',
  'node:util',
  'node:worker_threads',
] as const

/** jsdom's singletons, which tests stub in place (`navigator.clipboard`, `document.hasFocus`). */
const DOM_SINGLETONS = ['navigator', 'document', 'location', 'history'] as const

const TIMER_FUNCTIONS = [
  ['setTimeout', 'clearTimeout', true],
  ['setInterval', 'clearInterval', false],
  ['setImmediate', 'clearImmediate', true],
  // jsdom's frame callbacks run on its own timers, which the wrappers above never see.
  ['requestAnimationFrame', 'cancelAnimationFrame', true],
] as const

/** A global read by a name the code holds at runtime (a timer function, a DOM singleton). */
export function globalBinding(name: PropertyKey): unknown {
  return Reflect.get(globalThis, name)
}

/** Replaces the global `name`, as the timer tracking and the baseline marker do. */
export function setGlobalBinding(name: PropertyKey, value: unknown) {
  Reflect.set(globalThis, name, value)
}
const processEvents: EventEmitter = process

export function isWorkerProcessBaseline(value: unknown): value is WorkerProcessBaseline {
  return (
    typeof value === 'object' &&
    value !== null &&
    'brand' in value &&
    value.brand === BASELINE_BRAND
  )
}

function snapshot(target: object): ObjectSnapshot {
  const descriptors = new Map<PropertyKey, PropertyDescriptor>()
  for (const key of Reflect.ownKeys(target)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
    if (descriptor) descriptors.set(key, descriptor)
  }
  return { target, descriptors }
}

function restoreSnapshot(
  { target, descriptors }: ObjectSnapshot,
  keep: (key: PropertyKey) => boolean,
) {
  for (const key of Reflect.ownKeys(target)) {
    if (!descriptors.has(key) && !keep(key)) Reflect.deleteProperty(target, key)
  }
  for (const [key, descriptor] of descriptors) {
    const current = Reflect.getOwnPropertyDescriptor(target, key)
    const same =
      current !== undefined &&
      current.value === descriptor.value &&
      current.get === descriptor.get &&
      current.set === descriptor.set
    if (same || current?.configurable === false) continue
    Reflect.defineProperty(target, key, descriptor)
  }
}

function objectValue(value: unknown) {
  return typeof value === 'object' && value !== null ? value : undefined
}

function prototypeOf(value: unknown) {
  return typeof value === 'function' ? objectValue(value.prototype) : undefined
}

/** Each patched builtin's exports and its exported classes' prototypes, `Bun` and its parts. */
function ownedObjects() {
  const scope: object = globalThis
  const bun = objectValue('Bun' in scope ? scope.Bun : undefined)
  const roots: object[] = PATCHED_BUILTINS.map((name) => process.getBuiltinModule(name))
  if (bun) roots.push(bun)
  const objects = new Set<object>(roots)
  for (const root of roots) {
    for (const key of Reflect.ownKeys(root)) {
      const value: unknown = Reflect.getOwnPropertyDescriptor(root, key)?.value
      const part = prototypeOf(value) ?? (root === bun ? objectValue(value) : undefined)
      if (part) objects.add(part)
    }
  }
  for (const key of DOM_SINGLETONS) {
    const value = objectValue(globalBinding(key))
    if (value) objects.add(value)
  }
  return [...objects]
}

/** Every global class and its prototype (`Date.now`, `Element.prototype.scrollIntoView`). */
function sharedObjects() {
  const objects: object[] = []
  for (const key of Reflect.ownKeys(globalThis)) {
    const value: unknown = Reflect.getOwnPropertyDescriptor(globalThis, key)?.value
    if (typeof value !== 'function') continue
    objects.push(value)
    const prototype = prototypeOf(value)
    if (prototype) objects.push(prototype)
  }
  return objects
}

/**
 * Records the timers each file starts through the global timer functions, so the next file can
 * clear the ones still pending. Vitest's own timers use functions it saved before any setup file.
 */
function trackTimers() {
  const pending = new Map<unknown, (handle: unknown) => void>()
  for (const [set, clear, once] of TIMER_FUNCTIONS) {
    const start = globalBinding(set)
    const stop = globalBinding(clear)
    if (typeof start !== 'function' || typeof stop !== 'function') continue
    const cancel = (handle: unknown) => {
      Reflect.apply(stop, globalThis, [handle])
    }
    const trackedTimer = Object.assign(function trackedTimer(
      callback: unknown,
      ...rest: unknown[]
    ) {
      const timer: { handle?: unknown } = {}
      const run =
        once && typeof callback === 'function'
          ? (...args: unknown[]) => {
              pending.delete(timer.handle)
              Reflect.apply(callback, globalThis, args)
            }
          : callback
      timer.handle = Reflect.apply(start, globalThis, [run, ...rest])
      pending.set(timer.handle, cancel)
      return timer.handle
    }, start)
    setGlobalBinding(set, trackedTimer)
    setGlobalBinding(clear, function trackedClear(handle: unknown) {
      pending.delete(handle)
      cancel(handle)
    })
  }
  return pending
}

export function captureWorkerProcessBaseline(): WorkerProcessBaseline {
  // Before the global snapshot, so restoring the globals keeps the tracking functions.
  const timers = trackTimers()
  const clearDomListeners = trackDomListeners()
  return {
    brand: BASELINE_BRAND,
    env: { ...process.env },
    cwd: process.cwd(),
    globals: snapshot(globalThis),
    listeners: new Map(
      processEvents.eventNames().map((name) => [name, processEvents.listeners(name)] as const),
    ),
    owned: ownedObjects().map(snapshot),
    shared: sharedObjects().map(snapshot),
    timers,
    clearDomListeners,
  }
}

/** Removes the process listeners a file added since the baseline. */
function removeAddedProcessListeners(baseline: WorkerProcessBaseline) {
  const events: object = processEvents
  const removeListener: unknown = 'removeListener' in events ? events.removeListener : undefined
  if (typeof removeListener !== 'function') return
  for (const name of processEvents.eventNames()) {
    const kept = baseline.listeners.get(name) ?? []
    for (const listener of processEvents.listeners(name)) {
      if (kept.includes(listener)) continue
      Reflect.apply(removeListener, processEvents, [name, listener])
    }
  }
}

/** Puts the process back as the baseline found it; `keepGlobal` names globals to leave alone. */
export function restoreWorkerProcess(
  baseline: WorkerProcessBaseline,
  keepGlobal: (key: PropertyKey) => boolean,
) {
  for (const [handle, cancel] of baseline.timers) cancel(handle)
  baseline.timers.clear()
  baseline.clearDomListeners()
  // A file that set it would make the next file's process exit as failed. Bun keeps the old
  // code when given undefined, and 0 exits the same way.
  if (process.exitCode !== undefined) process.exitCode = 0
  for (const key of Object.keys(process.env)) {
    if (!Object.hasOwn(baseline.env, key)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(baseline.env)) {
    if (process.env[key] !== value) process.env[key] = value
  }
  if (process.cwd() !== baseline.cwd) process.chdir(baseline.cwd)
  restoreSnapshot(baseline.globals, keepGlobal)
  removeAddedProcessListeners(baseline)
  for (const owned of baseline.owned) restoreSnapshot(owned, () => false)
  for (const shared of baseline.shared) restoreSnapshot(shared, () => true)
}
