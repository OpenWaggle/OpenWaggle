import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import { useSyncExternalStore } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('project-authorization-default')

/**
 * The project's own authorization override, shared by every surface that has to name the mode in
 * force.
 *
 * Two surfaces need this read: the composer control and the Agent access settings section. Both
 * previously fetched it independently in a `useEffect`, which meant a change written in Settings did
 * not reach the composer — the control kept naming the old mode until it remounted, while the run
 * used the new one. A control that misstates the mode in force is the one thing it must not do, so
 * the read lives here with an explicit invalidation both writers call.
 *
 * Deliberately a tiny external store rather than a query client: the value is one nullable string per
 * project, read by two components, and invalidated by exactly one action.
 */
type Entry = { readonly mode: AgentAuthorizationMode | null } | undefined

const cache = new Map<string, Entry>()
const inFlight = new Set<string>()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function load(projectPath: string) {
  if (inFlight.has(projectPath)) return
  if (typeof api.getProjectPreferences !== 'function') {
    cache.set(projectPath, { mode: null })
    emit()
    return
  }

  inFlight.add(projectPath)
  api
    .getProjectPreferences(projectPath)
    .then((preferences) => {
      cache.set(projectPath, { mode: preferences?.authorizationMode ?? null })
    })
    .catch((error: unknown) => {
      logger.warn('Failed to read the project access mode', { error: String(error) })
      cache.set(projectPath, { mode: null })
    })
    .finally(() => {
      inFlight.delete(projectPath)
      emit()
    })
}

/**
 * Drops the cached value so the next render refetches.
 *
 * Call after writing a project authorization default. Without this the composer keeps naming the
 * previous mode.
 */
export function invalidateProjectAuthorizationDefault(projectPath: string | null) {
  if (!projectPath) return
  cache.delete(projectPath)
  emit()
}

/**
 * Reads the project's authorization override, or `null` while unknown or absent.
 *
 * `null` means "this project sets no override", which is not the same as full access: the caller
 * continues down the precedence chain to the global default.
 */
export function useProjectAuthorizationDefault(
  projectPath: string | null,
): AgentAuthorizationMode | null {
  const entry = useSyncExternalStore(
    subscribe,
    () => (projectPath ? cache.get(projectPath) : undefined),
    () => undefined,
  )

  if (projectPath && entry === undefined) {
    load(projectPath)
  }

  return entry?.mode ?? null
}
