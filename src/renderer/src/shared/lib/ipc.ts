import type { OpenWaggleApi } from '@shared/types/openwaggle-api'
import { createSessionControlQueryReader } from './session-control-query-reader'
import { createSessionDetailReader } from './session-detail-reader'

/**
 * Type-safe access to the preload API.
 * The global augmentation in env.d.ts declares window.api.
 *
 * In non-Electron browser contexts (or if preload fails), window.api is absent.
 * Return a safe proxy so renderer stays mounted and surfaces actionable errors.
 *
 * Every callable the proxy returns wraps its call so a rejected promise names the method that
 * rejected: `rejectedApiMethodOf` reads it, and error reports tag their event with it.
 */
/**
 * The name of the API method whose call rejected with an error, for error reporting. An IPC
 * error crosses the preload bridge as a new `Error` that keeps the message but loses the stack,
 * so a rejection nothing handles names no call site. The map holds the names instead of the
 * error, so nothing is written to the error itself and nothing leaks into what logs, JSON, or
 * `structuredClone` carry.
 */
const rejectedApiMethods = new WeakMap<object, string>()

/** One wrapper per method name, so a property read keeps returning the same function. */
const apiMethodWrappers = new Map<string, ApiMethod>()

/** A callable this module wraps, whatever its arguments and return. */
type ApiMethod = (...args: never[]) => unknown

function isApiMethod(value: unknown): value is ApiMethod {
  return typeof value === 'function'
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  )
}

/**
 * Wrap `method` so the error its returned promise rejects with names it. The same error is
 * rethrown, so callers see an identical rejection, only attributable. The first method that
 * an error flowed through keeps it: a reader wrapping an already-wrapped call must not rename
 * it, and a report later in a chain names the call that first failed.
 */
function reportingApiMethod(method: string, call: ApiMethod): ApiMethod {
  return (...args: never[]) => {
    const result = call(...args)
    if (!isThenable(result)) return result
    return result.then(undefined, (error: unknown) => {
      if (typeof error === 'object' && error !== null && !rejectedApiMethods.has(error)) {
        rejectedApiMethods.set(error, method)
      }
      throw error
    })
  }
}

/** Wrap `value`, the bridge's `method`, so its rejections are attributable. */
function reportingApiMethodValue(method: string, value: unknown): unknown {
  if (!isApiMethod(value)) return value
  const wrapped = apiMethodWrappers.get(method)
  if (wrapped) return wrapped
  const created = reportingApiMethod(method, value)
  apiMethodWrappers.set(method, created)
  return created
}

/**
 * The name of the API method whose rejected call reported `error`, when the rejection crossed
 * this bridge. Error reports read it to tag the event, so a stackless unhandled rejection from
 * an IPC call still names the method that failed.
 */
export function rejectedApiMethodOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? rejectedApiMethods.get(error) : undefined
}

function createMissingApiMethod(prop: string) {
  return (..._args: unknown[]) => {
    const message = `[ipc] window.api unavailable; attempted to call "${prop}". Ensure Electron main/preload have been restarted.`
    console.error(message)
    if (prop.startsWith('on')) {
      return () => {}
    }
    return Promise.reject(new Error(message))
  }
}

function createApiProxy(base?: OpenWaggleApi) {
  // Detail reads move only appended messages; callers still receive a complete detail (D5).
  const readSessionDetail = base
    ? createSessionDetailReader((id, cursor) => base.getSessionDetail(id, cursor))
    : undefined
  const querySessionControl = base
    ? createSessionControlQueryReader((request) => base.querySessionControl(request))
    : undefined
  const handler: ProxyHandler<OpenWaggleApi> = {
    has(_target, prop) {
      return base !== undefined && Reflect.has(base, prop)
    },
    get(_target, prop) {
      if (prop === 'getSessionDetail' && readSessionDetail) {
        return reportingApiMethodValue('getSessionDetail', readSessionDetail)
      }
      if (prop === 'querySessionControl' && querySessionControl) {
        return reportingApiMethodValue('querySessionControl', querySessionControl)
      }
      if (base) {
        const value = Reflect.get(base, prop)
        if (value !== undefined) {
          return typeof prop === 'string' ? reportingApiMethodValue(prop, value) : value
        }
      }

      if (
        typeof prop !== 'string' ||
        prop === 'then' ||
        prop === 'toJSON' ||
        prop === 'hasAttribute'
      ) {
        return undefined
      }

      return reportingApiMethodValue(prop, createMissingApiMethod(prop))
    },
  }

  return new Proxy<OpenWaggleApi>(Object.create(null), handler)
}

export const api: OpenWaggleApi = createApiProxy(
  typeof window === 'undefined' ? undefined : window.api,
)
