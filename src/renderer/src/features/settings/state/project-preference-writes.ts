import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { Settings } from '@shared/types/settings'
import { api } from '@/shared/lib/ipc'
import type { PreferencesGet, PreferencesSet } from './preferences-store-types'

/** In-flight project preference writes per path; removals await them so a delete cannot be overtaken. */
const pendingProjectPreferenceWrites = new Map<string, Promise<void>>()

function mergeSettings(set: PreferencesSet, patch: Partial<Settings>) {
  set((state) => ({ settings: { ...state.settings, ...patch } }))
}

/**
 * Re-keys the renderer's per-project state from an aliased path to the canonical identity the
 * backend reports, so later reads, writes, and removals all address the same entry. Every
 * project-keyed settings map must move together or Session Host policy lookups by the canonical
 * path would silently lose overrides stored under the alias.
 */
async function reconcileProjectIdentity(
  requestedPath: string,
  canonicalPath: string,
  set: PreferencesSet,
  get: PreferencesGet,
) {
  const { settings } = get()
  const remapPath = (path: string) => (path === requestedPath ? canonicalPath : path)
  // The aliased path is the identity the user just interacted through, so its entry wins on
  // conflict; entries that only existed under the canonical key are preserved by the merge.
  function rekeyFlat<V>(record: Record<string, V>): Record<string, V> {
    if (!(requestedPath in record)) return record
    const next = { ...record, [canonicalPath]: record[requestedPath] }
    delete next[requestedPath]
    return next
  }
  function rekeyNested(
    record: Record<string, Readonly<Record<string, boolean>>>,
  ): Record<string, Record<string, boolean>> {
    if (!(requestedPath in record)) return record
    const merged = {
      ...(record[canonicalPath] ?? {}),
      ...record[requestedPath],
    }
    const next = { ...record, [canonicalPath]: merged }
    delete next[requestedPath]
    return next
  }
  const patch: Partial<Settings> = {
    recentProjects: settings.recentProjects.map(remapPath),
    projectDisplayNames: rekeyFlat({ ...settings.projectDisplayNames }),
    skillTogglesByProject: rekeyNested({ ...settings.skillTogglesByProject }),
    agentDefinitionTogglesByProject: rekeyNested({ ...settings.agentDefinitionTogglesByProject }),
    multiAgentEnabledByProject: rekeyFlat({ ...settings.multiAgentEnabledByProject }),
    sessionHostParentConcurrencyLimitsByProject: rekeyFlat({
      ...settings.sessionHostParentConcurrencyLimitsByProject,
    }),
    ...(settings.projectPath === requestedPath ? { projectPath: canonicalPath } : {}),
  }
  const result = await api.updateSettings(patch)
  if (!result.ok) throw new Error(result.error)
  mergeSettings(set, patch)
}

/**
 * Chains a project preference write onto any in-flight write for the same path — each Host-backed
 * invocation uses a separate Local Session connection, so ordering is not guaranteed without this.
 * When the backend reports a canonical path that differs from the requested one, the renderer's
 * per-project state and the pending-write tracking are re-keyed onto that identity, covering
 * aliases stored before folder-picker canonicalization.
 */
export function persistProjectPreference(
  projectPath: string | null,
  prefs: {
    model?: string
    thinkingLevel?: string
    authorizationMode?: AgentAuthorizationMode | null
  },
  set?: PreferencesSet,
  get?: PreferencesGet,
): Promise<void> {
  if (!projectPath) return Promise.resolve()
  const previous = pendingProjectPreferenceWrites.get(projectPath)
  const tracked = (previous ?? Promise.resolve())
    .then(() => api.setProjectPreferences(projectPath, prefs))
    .then(async (canonicalPath) => {
      if (!canonicalPath || canonicalPath === projectPath) return
      if (set && get) await reconcileProjectIdentity(projectPath, canonicalPath, set, get)
      // Whatever is still queued under the aliased key moves with the identity, so a removal
      // addressed by the canonical path keeps waiting for it.
      const stillPending = pendingProjectPreferenceWrites.get(projectPath)
      if (stillPending) {
        pendingProjectPreferenceWrites.delete(projectPath)
        pendingProjectPreferenceWrites.set(canonicalPath, stillPending)
      }
    })
    // Failures propagate: fire-and-forget callers log them, callers that expose save state show
    // the failure instead of claiming success while the old value remains on disk.
    // Cleanup matches by promise identity, not key, because the entry may have been re-keyed.
    .finally(() => {
      for (const [key, pending] of pendingProjectPreferenceWrites) {
        if (pending === tracked) pendingProjectPreferenceWrites.delete(key)
      }
    })
  pendingProjectPreferenceWrites.set(projectPath, tracked)
  return tracked
}

/** Resolves once every in-flight preference write for the given project path has settled. A failed write persisted nothing, so its rejection does not block removal. */
export function awaitPendingProjectPreferenceWrites(projectPath: string): Promise<void> {
  const pending = pendingProjectPreferenceWrites.get(projectPath) ?? Promise.resolve()
  return pending.catch(() => undefined)
}
