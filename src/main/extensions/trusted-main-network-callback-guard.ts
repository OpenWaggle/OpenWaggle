import { EventEmitter } from 'node:events'

export type TrustedMainEventListener = (this: EventEmitter, ...args: unknown[]) => unknown

interface TrustedMainNetworkCallbackGuardInput {
  readonly bindListener: (listener: TrustedMainEventListener) => TrustedMainEventListener
}

type EmitterListenerMethod = (
  this: EventEmitter,
  eventName: string | symbol,
  listener: TrustedMainEventListener,
) => EventEmitter

function isEmitterListenerMethod(value: unknown): value is EmitterListenerMethod {
  return typeof value === 'function'
}

/** The method as Node defines it, read before the guard below replaces it. */
function originalEmitterMethod(name: 'addListener' | 'on' | 'prependListener' | 'removeListener') {
  const method: unknown = Reflect.get(EventEmitter.prototype, name)
  if (!isEmitterListenerMethod(method)) {
    throw new TypeError(`node:events EventEmitter.prototype.${name} is unavailable.`)
  }
  return method
}

const originalAddListener = originalEmitterMethod('addListener')
const originalOn = originalEmitterMethod('on')
const originalPrependListener = originalEmitterMethod('prependListener')
const originalRemoveListener = originalEmitterMethod('removeListener')

function exposeOriginalListener(
  listener: TrustedMainEventListener,
  originalListener: TrustedMainEventListener,
) {
  Object.defineProperty(listener, 'listener', {
    configurable: true,
    value: originalListener,
  })
  return listener
}

const LISTENER_METHODS = [
  'addListener',
  'on',
  'once',
  'prependListener',
  'prependOnceListener',
] as const

const REMOVE_LISTENER_METHODS = ['removeListener', 'off'] as const

function isListener(value: unknown): value is TrustedMainEventListener {
  return typeof value === 'function'
}

function isListenerMethod(
  value: unknown,
): value is (this: unknown, eventName: unknown, listener: unknown, ...rest: unknown[]) => unknown {
  return typeof value === 'function'
}

/**
 * Bun's `process` is a native emitter whose prototype has its own listener methods, so the
 * `EventEmitter.prototype` patches below never see `process.on` or `process.once`. Node's
 * `process` inherits them, and this finds nothing to patch.
 */
function installOwnEmitterGuard(prototype: object, input: TrustedMainNetworkCallbackGuardInput) {
  // The native emitter compares listeners by identity, not by the bound listener's `listener`.
  const boundListeners = new WeakMap<
    TrustedMainEventListener,
    Map<unknown, TrustedMainEventListener[]>
  >()
  function bindAndRemember(eventName: unknown, listener: TrustedMainEventListener) {
    const boundListener = input.bindListener(listener)
    if (boundListener !== listener) {
      const byEvent = boundListeners.get(listener) ?? new Map<unknown, TrustedMainEventListener[]>()
      byEvent.set(eventName, [...(byEvent.get(eventName) ?? []), boundListener])
      boundListeners.set(listener, byEvent)
    }
    return boundListener
  }
  function takeBoundListener(eventName: unknown, listener: unknown) {
    const bound = isListener(listener) ? boundListeners.get(listener)?.get(eventName) : undefined
    return bound?.pop()
  }
  for (const methodName of REMOVE_LISTENER_METHODS) {
    const original: unknown = Reflect.get(prototype, methodName)
    if (!Object.hasOwn(prototype, methodName) || !isListenerMethod(original)) {
      continue
    }
    Object.defineProperty(prototype, methodName, {
      configurable: true,
      writable: true,
      value: function removePolicyBoundListener(
        this: unknown,
        eventName: unknown,
        listener: unknown,
      ) {
        const boundListener = takeBoundListener(eventName, listener)
        return Reflect.apply(original, this, [eventName, boundListener ?? listener])
      },
    })
  }
  for (const methodName of LISTENER_METHODS) {
    const original: unknown = Reflect.get(prototype, methodName)
    if (!Object.hasOwn(prototype, methodName) || !isListenerMethod(original)) {
      continue
    }
    Object.defineProperty(prototype, methodName, {
      configurable: true,
      writable: true,
      value: function policyBoundEmitterMethod(
        this: unknown,
        eventName: unknown,
        listener: unknown,
        ...rest: unknown[]
      ) {
        const boundListener = isListener(listener) ? bindAndRemember(eventName, listener) : listener
        return Reflect.apply(original, this, [eventName, boundListener, ...rest])
      },
    })
  }
}

export function installTrustedMainNetworkCallbackGuard(
  input: TrustedMainNetworkCallbackGuardInput,
) {
  const processPrototype: unknown = Object.getPrototypeOf(process)
  if (
    typeof processPrototype === 'object' &&
    processPrototype !== null &&
    processPrototype !== EventEmitter.prototype
  ) {
    installOwnEmitterGuard(processPrototype, input)
  }

  function addPolicyBoundListener(
    this: EventEmitter,
    eventName: string | symbol,
    listener: TrustedMainEventListener,
  ) {
    return originalAddListener.call(this, eventName, input.bindListener(listener))
  }

  function onPolicyBoundEvent(
    this: EventEmitter,
    eventName: string | symbol,
    listener: TrustedMainEventListener,
  ) {
    return originalOn.call(this, eventName, input.bindListener(listener))
  }

  function prependPolicyBoundListener(
    this: EventEmitter,
    eventName: string | symbol,
    listener: TrustedMainEventListener,
  ) {
    return originalPrependListener.call(this, eventName, input.bindListener(listener))
  }

  function oncePolicyBoundListener(
    emitter: EventEmitter,
    eventName: string | symbol,
    listener: TrustedMainEventListener,
  ) {
    const boundListener = input.bindListener(listener)
    return exposeOriginalListener(function oncePolicyBoundEventListener(
      this: EventEmitter,
      ...args: unknown[]
    ) {
      originalRemoveListener.call(emitter, eventName, oncePolicyBoundEventListener)
      return boundListener.apply(this, args)
    }, listener)
  }

  function oncePolicyBoundEvent(
    this: EventEmitter,
    eventName: string | symbol,
    listener: TrustedMainEventListener,
  ) {
    return originalAddListener.call(
      this,
      eventName,
      oncePolicyBoundListener(this, eventName, listener),
    )
  }

  function prependOncePolicyBoundEvent(
    this: EventEmitter,
    eventName: string | symbol,
    listener: TrustedMainEventListener,
  ) {
    return originalPrependListener.call(
      this,
      eventName,
      oncePolicyBoundListener(this, eventName, listener),
    )
  }

  Object.defineProperties(EventEmitter.prototype, {
    addListener: { configurable: true, value: addPolicyBoundListener, writable: true },
    on: { configurable: true, value: onPolicyBoundEvent, writable: true },
    once: { configurable: true, value: oncePolicyBoundEvent, writable: true },
    prependListener: {
      configurable: true,
      value: prependPolicyBoundListener,
      writable: true,
    },
    prependOnceListener: {
      configurable: true,
      value: prependOncePolicyBoundEvent,
      writable: true,
    },
  })
}
