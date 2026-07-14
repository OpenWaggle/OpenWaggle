export interface TrustedMainNetworkEscapeGuard {
  readonly enforceBlockedApi: (api: string, reason: string) => void
}

export type TrustedMainNetworkEscapePatchInstaller = (guard: TrustedMainNetworkEscapeGuard) => void

interface CallablePatch<Args extends readonly unknown[], Result> {
  readonly target: object
  readonly propertyName: string
  readonly original: (...args: Args) => Result
  readonly api: string
  readonly reason: string
}

interface ConstructablePatch<Args extends readonly unknown[], Result extends object> {
  readonly target: object
  readonly propertyName: string
  readonly original: new (...args: Args) => Result
  readonly api: string
  readonly reason: string
}

function definePatchedValue(target: object, propertyName: string, value: unknown) {
  Object.defineProperty(target, propertyName, {
    configurable: true,
    writable: true,
    value,
  })
}

export function callablePatch<Args extends readonly unknown[], Result>(
  patch: CallablePatch<Args, Result>,
): TrustedMainNetworkEscapePatchInstaller {
  return (guard) => {
    definePatchedValue(patch.target, patch.propertyName, (...args: Args) => {
      guard.enforceBlockedApi(patch.api, patch.reason)
      return patch.original(...args)
    })
  }
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
