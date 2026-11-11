export interface TrustedMainNetworkEscapeGuard {
  readonly enforceBlockedApi: (api: string, reason: string) => void
  readonly isAuthorizedHostname: (hostname: unknown) => boolean
}

export type TrustedMainNetworkEscapePatchInstaller = (guard: TrustedMainNetworkEscapeGuard) => void

interface CallablePatch<Args extends readonly unknown[], Result> {
  readonly target: object
  readonly propertyName: string
  readonly original: (...args: Args) => Result
  readonly api: string
  readonly reason: string
  /** A DNS lookup of the host that an allowed HTTPS request connects to passes. */
  readonly allowsAuthorizedHostname?: boolean
}

interface ConstructablePatch<Args extends readonly unknown[], Result extends object> {
  readonly target: object
  readonly propertyName: string
  readonly original: new (...args: Args) => Result
  readonly api: string
  readonly reason: string
}

type Constructor = new (...args: readonly unknown[]) => object

function isConstructor(value: unknown): value is Constructor {
  return typeof value === 'function'
}

function isMethod(
  value: unknown,
): value is (this: unknown, ...args: readonly unknown[]) => unknown {
  return typeof value === 'function'
}

function definePatchedValue(target: object, propertyName: string, value: unknown) {
  Object.defineProperty(target, propertyName, {
    configurable: true,
    writable: true,
    value,
  })
}

/** Replaces a function, a module export or a prototype method, keeping its receiver. */
export function callablePatch<Args extends readonly unknown[], Result>(
  patch: CallablePatch<Args, Result>,
): TrustedMainNetworkEscapePatchInstaller {
  return (guard) => {
    definePatchedValue(
      patch.target,
      patch.propertyName,
      function guardedCallable(this: unknown, ...args: Args): Result {
        if (!(patch.allowsAuthorizedHostname === true && guard.isAuthorizedHostname(args[0]))) {
          guard.enforceBlockedApi(patch.api, patch.reason)
        }
        return Reflect.apply(patch.original, this, args)
      },
    )
  }
}

/**
 * Replaces a method read off its object, so no unbound reference to it is taken: a prototype or
 * module method, or one the type definitions do not declare, such as `ChildProcess#spawn`.
 */
export function prototypeMethodPatch(patch: {
  readonly target: object
  readonly propertyName: string
  readonly api: string
  readonly reason: string
}): TrustedMainNetworkEscapePatchInstaller {
  const original: unknown = Reflect.get(patch.target, patch.propertyName)
  if (!isMethod(original)) {
    throw new TypeError(`${patch.api} is unavailable.`)
  }
  return callablePatch({ ...patch, original })
}

export function constructablePatch<Args extends readonly unknown[], Result extends object>(
  patch: ConstructablePatch<Args, Result>,
): TrustedMainNetworkEscapePatchInstaller {
  return (guard) => {
    function patchedConstructable(...args: Args) {
      guard.enforceBlockedApi(patch.api, patch.reason)
      return new patch.original(...args)
    }

    definePatchedValue(patch.target, patch.propertyName, patchedConstructable)
  }
}

/**
 * Guards construction of a class that extends `base`, however it was imported. Bun fixes builtin
 * ESM exports when first imported, so replacing the class on its module object misses named
 * imports. A derived constructor's `super()` calls the class's current prototype, so a guarded
 * base inserted there runs on every `new`, and leaves the class, its statics and `instanceof`
 * unchanged. A second installation (a reloaded guard module) wraps the first.
 */
export function superclassPatch(patch: {
  readonly derived: abstract new (...args: never[]) => object
  readonly base: new (...args: never[]) => object
  readonly api: string
  readonly reason: string
}): TrustedMainNetworkEscapePatchInstaller {
  return (guard) => {
    const currentBase: unknown = Object.getPrototypeOf(patch.derived)
    if (
      !isConstructor(currentBase) ||
      (currentBase !== patch.base && !Object.prototype.isPrototypeOf.call(patch.base, currentBase))
    ) {
      throw new TypeError(`${patch.api} no longer extends the class its guard wraps.`)
    }
    const superclass: Constructor = currentBase
    function GuardedBase(this: unknown, ...args: readonly unknown[]): object {
      guard.enforceBlockedApi(patch.api, patch.reason)
      const instance: unknown = Reflect.construct(superclass, args, new.target)
      if (typeof instance !== 'object' || instance === null) {
        throw new TypeError(`${patch.api} did not construct an object.`)
      }
      return instance
    }
    const basePrototype: unknown = patch.base.prototype
    Object.setPrototypeOf(GuardedBase, superclass)
    GuardedBase.prototype = basePrototype
    Object.setPrototypeOf(patch.derived, GuardedBase)
  }
}
