/**
 * The listeners test files leave on jsdom's window, document, html and body, which outlive a file
 * in a reused worker (`worker-process-baseline.ts`).
 */
const scope: Record<PropertyKey, unknown> = globalThis

function persistentDomTargets(): unknown[] {
  const document = scope.document
  if (typeof document !== 'object' || document === null) return []
  return [
    document,
    Reflect.get(document, 'documentElement'),
    Reflect.get(document, 'body'),
    Reflect.get(document, 'head'),
  ]
}

/** Whether listener options ask for the capture phase, which is part of a listener's identity. */
function captures(options: unknown) {
  return (
    options === true ||
    (typeof options === 'object' && options !== null && Reflect.get(options, 'capture') === true)
  )
}

const SELF = new URL(import.meta.url).pathname

/**
 * Whether the code adding a listener is a dependency Vitest loads outside its module graph. Such a
 * dependency is not evaluated again for the next file, and may remember that it added the listener:
 * React marks the document and a portal's body once, and adds its listeners to them only then.
 */
function addedByExternalDependency(stack: string | undefined) {
  const caller = stack?.split('\n').find((line) => line.includes(' at ') && !line.includes(SELF))
  return caller?.includes('/node_modules/') === true
}

/** A listener a file added, and how to remove it. */
type DomListener = readonly [unknown, (...args: unknown[]) => unknown, readonly unknown[]]

/**
 * Wraps `holder`'s addEventListener and removeEventListener so a listener added to one of
 * `targets` (or to `holder` itself, when `targets` is empty) is recorded until it is removed.
 */
function wrapListenerMethods(
  tag: string,
  holder: object,
  targets: readonly unknown[],
  listeners: Map<string, DomListener>,
) {
  const add: unknown = Reflect.get(holder, 'addEventListener')
  const remove: unknown = Reflect.get(holder, 'removeEventListener')
  if (typeof add !== 'function' || typeof remove !== 'function') return
  const ids = new WeakMap<object, number>()
  const counter = { next: 0 }
  const id = (value: unknown) => {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
      return String(value)
    }
    const known = ids.get(value)
    if (known !== undefined) return String(known)
    counter.next += 1
    ids.set(value, counter.next)
    return String(counter.next)
  }
  const key = (target: unknown, [type, listener, options]: readonly unknown[]) =>
    `${tag}:${id(target)}:${String(type)}:${id(listener)}:${String(captures(options))}`
  const tracks = (target: unknown) => (targets.length === 0 ? true : targets.includes(target))
  const removeFrom = (target: unknown, ...args: unknown[]): unknown =>
    Reflect.apply(remove, target, args)
  Reflect.set(holder, 'addEventListener', function trackedAdd(this: unknown, ...args: unknown[]) {
    if (tracks(this) && !addedByExternalDependency(new Error('listener').stack)) {
      listeners.set(key(this, args), [this, removeFrom, args])
    }
    const added: unknown = Reflect.apply(add, this, args)
    return added
  })
  Reflect.set(
    holder,
    'removeEventListener',
    function trackedRemove(this: unknown, ...args: unknown[]) {
      listeners.delete(key(this, args))
      const removed: unknown = Reflect.apply(remove, this, args)
      return removed
    },
  )
}

/**
 * Records the listeners test and app code add to the window, document, html and body, so the next
 * file can remove the ones a file left: the components that added them are unmounted, and a stale one
 * would answer the next file's events with the previous file's modules. Vitest's jsdom window
 * methods are the global's own wrappers, so the global is wrapped as well as EventTarget.
 */
export function trackDomListeners() {
  const listeners = new Map<string, DomListener>()
  const targets = persistentDomTargets()
  if (targets.length === 0) return () => undefined
  const eventTarget = scope.EventTarget
  const prototype: unknown =
    typeof eventTarget === 'function' ? Reflect.get(eventTarget, 'prototype') : undefined
  if (typeof prototype === 'object' && prototype !== null) {
    wrapListenerMethods('dom', prototype, targets, listeners)
  }
  if (Object.hasOwn(globalThis, 'addEventListener')) {
    wrapListenerMethods('window', globalThis, [], listeners)
  }
  return () => {
    for (const [target, removeFrom, args] of listeners.values()) removeFrom(target, ...args)
    listeners.clear()
  }
}
