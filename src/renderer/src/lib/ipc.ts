import type { OpenHiveApi } from '@shared/types/ipc'

/**
 * Type-safe access to the preload API.
 * The global augmentation in env.d.ts declares window.api.
 *
 * In non-Electron browser contexts (or if preload fails), window.api is absent.
 * Return a safe proxy so renderer stays mounted and surfaces actionable errors.
 */
function createUnavailableApiProxy(): OpenHiveApi {
  const fallback = new Proxy<Record<string, unknown>>(
    {},
    {
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
    },
  )
  return fallback as unknown as OpenHiveApi
}

export const api: OpenHiveApi = window.api ?? createUnavailableApiProxy()
