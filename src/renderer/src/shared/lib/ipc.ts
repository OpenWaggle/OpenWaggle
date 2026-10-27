import type { OpenWaggleApi } from '@shared/types/openwaggle-api'
import { createSessionControlQueryReader } from './session-control-query-reader'
import { createSessionDetailReader } from './session-detail-reader'

/**
 * Type-safe access to the preload API.
 * The global augmentation in env.d.ts declares window.api.
 *
 * In non-Electron browser contexts (or if preload fails), window.api is absent.
 * Return a safe proxy so renderer stays mounted and surfaces actionable errors.
 */
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
      if (prop === 'getSessionDetail' && readSessionDetail) return readSessionDetail
      if (prop === 'querySessionControl' && querySessionControl) return querySessionControl
      if (base) {
        const value = Reflect.get(base, prop)
        if (value !== undefined) {
          return value
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

      return createMissingApiMethod(prop)
    },
  }

  return new Proxy<OpenWaggleApi>(Object.create(null), handler)
}

export const api: OpenWaggleApi = createApiProxy(
  typeof window === 'undefined' ? undefined : window.api,
)
