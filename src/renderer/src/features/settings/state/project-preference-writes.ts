import type { Settings } from '@shared/types/settings'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import type { PreferencesGet, PreferencesSet } from './preferences-store-types'

const logger = createRendererLogger('preferences')

/** In-flight project preference writes per path; removals await them so a delete cannot be overtaken. */
const pendingProjectPreferenceWrites = new Map<string, Promise<void>>()

function mergeSettings(set: PreferencesSet, patch: Partial<Settings>) {
  set((state) => ({ settings: { ...state.settings, ...patch } }))
}

/**
 * Re-keys the renderer's per-project state from an aliased path to the canonical identity the
 * backend reports, so later reads, writes, and removals all address the same entry.
 */
async function reconcileProjectIdentity(
  requestedPath: string,
  canonicalPath: string,
  set: PreferencesSet,
  get: PreferencesGet,
) {
  const { settings } = get()
  const remapPath = (path: string) => (path === requestedPath ? canonicalPath : path)
  const projectDisplayNames = { ...settings.projectDisplayNames }
  if (requestedPath in projectDisplayNames) {
    projectDisplayNames[canonicalPath] = projectDisplayNames[requestedPath]
    delete projectDisplayNames[requestedPath]
  }
  const skillTogglesByProject = { ...settings.skillTogglesByProject }
  if (requestedPath in skillTogglesByProject) {
    skillTogglesByProject[canonicalPath] = skillTogglesByProject[requestedPath]
    delete skillTogglesByProject[requestedPath]
  }
  const patch: Partial<Settings> = {
    recentProjects: settings.recentProjects.map(remapPath),
    projectDisplayNames,
    skillTogglesByProject,
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
  prefs: { model?: string; thinkingLevel?: string },
  set: PreferencesSet,
  get: PreferencesGet,
) {
  if (!projectPath) return
  const previous = pendingProjectPreferenceWrites.get(projectPath)
  const tracked = (previous ?? Promise.resolve())
    .then(() => api.setProjectPreferences(projectPath, prefs))
    .then(async (canonicalPath) => {
      if (!canonicalPath || canonicalPath === projectPath) return
      await reconcileProjectIdentity(projectPath, canonicalPath, set, get)
      // Whatever is still queued under the aliased key moves with the identity, so a removal
      // addressed by the canonical path keeps waiting for it.
      const stillPending = pendingProjectPreferenceWrites.get(projectPath)
      if (stillPending) {
        pendingProjectPreferenceWrites.delete(projectPath)
        pendingProjectPreferenceWrites.set(canonicalPath, stillPending)
      }
    })
    .catch((err: unknown) => {
      logger.warn('Failed to persist project preferences', { error: String(err) })
    })
    // Cleanup matches by promise identity, not key, because the entry may have been re-keyed.
    .finally(() => {
      for (const [key, pending] of pendingProjectPreferenceWrites) {
        if (pending === tracked) pendingProjectPreferenceWrites.delete(key)
      }
    })
  pendingProjectPreferenceWrites.set(projectPath, tracked)
}

/** Resolves once every in-flight preference write for the given project path has settled. */
export function awaitPendingProjectPreferenceWrites(projectPath: string): Promise<void> {
  return pendingProjectPreferenceWrites.get(projectPath) ?? Promise.resolve()
}
