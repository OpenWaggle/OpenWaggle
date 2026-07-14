import { EventEmitter } from 'node:events'

export type TrustedMainEventListener = (this: EventEmitter, ...args: unknown[]) => unknown

interface TrustedMainNetworkCallbackGuardInput {
  readonly bindListener: (listener: TrustedMainEventListener) => TrustedMainEventListener
}

const originalAddListener = EventEmitter.prototype.addListener
const originalOn = EventEmitter.prototype.on
const originalPrependListener = EventEmitter.prototype.prependListener
const originalRemoveListener = EventEmitter.prototype.removeListener

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

export function installTrustedMainNetworkCallbackGuard(
  input: TrustedMainNetworkCallbackGuardInput,
) {
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
