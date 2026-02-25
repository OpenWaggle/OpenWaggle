import type { OpenWaggleApi } from '@shared/types/ipc'

/**
 * Type-safe access to the preload API.
 * The global augmentation in env.d.ts declares window.api.
 *
 * In non-Electron browser contexts (or if preload fails), window.api is absent.
 * Return a safe proxy so renderer stays mounted and surfaces actionable errors.
 */
function createUnavailableApiProxy(): OpenWaggleApi {
  const handler: ProxyHandler<OpenWaggleApi> = {
    get(_target, prop) {
      return (..._args: unknown[]) => {
        const message = `[ipc] window.api unavailable; attempted to call "${String(prop)}". Ensure renderer is running inside Electron with preload loaded.`
        console.error(message)
        if (String(prop).startsWith('on')) {
          return () => {}
        }
        return Promise.reject(new Error(message))
      }
    },
  }
  // Proxy intercepts all property access via the handler — the target is never
  // accessed directly. Object.create(null) returns `any` which satisfies the
  // Proxy<T> constructor; this is an inherent limitation of proxying interfaces.
  return new Proxy<OpenWaggleApi>(Object.create(null), handler)
}

export const api: OpenWaggleApi = window.api ?? createUnavailableApiProxy()
