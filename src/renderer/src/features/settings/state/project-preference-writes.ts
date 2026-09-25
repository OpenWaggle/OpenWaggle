import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { Settings } from '@shared/types/settings'
import { api } from '@/shared/lib/ipc'
import type { PreferencesGet, PreferencesSet } from './preferences-store-types'

/** In-flight project preference writes per path; removals await them so a delete cannot be overtaken. */
const pendingProjectPreferenceWrites = new Map<string, Promise<void>>()
/** Projects with a removal in flight: new preference writes are suppressed so they cannot recreate the deleted entry. */
const removingProjectPaths = new Set<string>()
/** Removal markers copied onto a canonical identity while the original removal is in flight, so a failed removal can clear the copies together with the original. */
const removalMarkerCopies = new Map<string, string>()

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
    const merged = { ...(record[canonicalPath] ?? {}), ...record[requestedPath] }
    const next = { ...record, [canonicalPath]: merged }
    delete next[requestedPath]
    return next
  }
  // Both the alias and its canonical path may already be listed; keep one unique ordered entry.
  const seen = new Set<string>()
  const recentProjects: string[] = []
  for (const entry of settings.recentProjects) {
    const mapped = remapPath(entry)
    if (!seen.has(mapped)) {
      seen.add(mapped)
      recentProjects.push(mapped)
    }
  }
  const patch: Partial<Settings> = {
    recentProjects,
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
 * A failed earlier write does not block the next one; each request's own failure still propagates
 * to its caller.
 *
 * When the backend reports a canonical path that differs from the requested one, the renderer's
 * per-project state and the pending-write tracking are re-keyed onto that identity, covering
 * aliases stored before folder-picker canonicalization. Callers that pass no store access do not
 * reconcile, so the chain stays tracked under both identities until cleanup.
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
  if (removingProjectPaths.has(projectPath)) {
    // The project is being removed; a new write would recreate the supposedly deleted entry.
    // Reporting success here would let callers show a value that was never saved.
    return Promise.reject(
      new Error(`A removal of ${projectPath} is in flight; the change was not saved.`),
    )
  }
  const previous = pendingProjectPreferenceWrites.get(projectPath)
  const tracked = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => api.setProjectPreferences(projectPath, prefs))
    .then(async (canonicalPath) => {
      if (!canonicalPath || canonicalPath === projectPath) return
      if (set && get) {
        await reconcileProjectIdentity(projectPath, canonicalPath, set, get)
        // Renderer state now names the canonical path, so the whole chain moves with it and a
        // removal addressed by the canonical path keeps waiting for it. An in-flight removal
        // marker moves too, or writes via the new identity would bypass the removal guard.
        const stillPending = pendingProjectPreferenceWrites.get(projectPath)
        if (stillPending) {
          pendingProjectPreferenceWrites.delete(projectPath)
          pendingProjectPreferenceWrites.set(canonicalPath, stillPending)
        }
        if (removingProjectPaths.has(projectPath)) {
          removingProjectPaths.add(canonicalPath)
          removalMarkerCopies.set(canonicalPath, projectPath)
        }
      } else {
        // Renderer state still names the alias (this caller does not reconcile), so the chain is
        // tracked under both identities and a removal addressed by either one waits for it.
        pendingProjectPreferenceWrites.set(
          canonicalPath,
          pendingProjectPreferenceWrites.get(projectPath) ?? tracked,
        )
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

/**
 * Runs the backend deletion after every in-flight preference write for the path has settled, and
 * suppresses writes that start while the deletion is in flight so they cannot recreate the entry.
 */
/** Deletes the removal markers copied onto canonical identities for a completed or failed removal. */
function clearRemovalMarkerCopies(originalPath: string) {
  for (const [copiedPath, from] of removalMarkerCopies) {
    if (from === originalPath) {
      removalMarkerCopies.delete(copiedPath)
      removingProjectPaths.delete(copiedPath)
    }
  }
}

/**
 * Runs the backend removal after every in-flight preference write for the path has settled, and
 * suppresses writes that start while it is in flight so they cannot recreate the entry. The lock
 * covers the whole perform step — deletion plus reference cleanup — so a model change cannot pass
 * the guard mid-removal and orphan itself afterwards.
 */
export function removeProjectModelTracked(
  projectPath: string,
  perform: () => Promise<string>,
): Promise<string> {
  removingProjectPaths.add(projectPath)
  const pending = pendingProjectPreferenceWrites.get(projectPath) ?? Promise.resolve()
  return pending
    .catch(() => undefined)
    .then(perform)
    .then((canonicalPath) => {
      // The re-key may have copied the removal marker onto the canonical identity.
      clearRemovalMarkerCopies(projectPath)
      removingProjectPaths.delete(projectPath)
      if (canonicalPath) removingProjectPaths.delete(canonicalPath)
      return canonicalPath
    })
    .catch((err: unknown) => {
      // A failed removal leaves the project visible and retryable; clear the alias marker and
      // any canonical copy so writes resume.
      clearRemovalMarkerCopies(projectPath)
      removingProjectPaths.delete(projectPath)
      throw err
    })
}

/** Resolves once every in-flight preference write for the given project path has settled. A failed write persisted nothing, so its rejection does not block removal. */
export function awaitPendingProjectPreferenceWrites(projectPath: string): Promise<void> {
  const pending = pendingProjectPreferenceWrites.get(projectPath) ?? Promise.resolve()
  return pending.catch(() => undefined)
}

/** One project's reference snapshot, captured before its stored model is removed. */
interface ProjectReferenceSnapshot {
  projectPath: string | null
  recentProjects: string[]
  projectDisplayNames: Record<string, string>
  skillTogglesByProject: Record<string, Record<string, boolean>>
}

/**
 * Deletes the stored model and persists the reference removal as one locked step. When the
 * reference update fails after the model is already gone, the project stays visible, so the last
 * saved model is restored before the failure propagates — the user retries instead of losing the
 * preference silently.
 */
export async function removeModelAndReferences(
  path: string,
  snapshot: ProjectReferenceSnapshot,
): Promise<string> {
  // Surviving references that resolve to the same identity keep the stored model alive.
  const remainingReferences = [
    ...snapshot.recentProjects,
    ...(snapshot.projectPath ? [snapshot.projectPath] : []),
  ]
  // Captured after the in-flight write chain settles, so compensation sees the last saved model.
  const previousPrefs = await api.getProjectPreferences(path)
  try {
    // The Host removal itself is several separately persisted steps (legacy-file strip, model
    // entry, alias records), so it can reject after the model is already gone; the rollback
    // scope must cover it, not just the reference update.
    const canonicalPath = await api.removeProjectModel(path, remainingReferences)
    const result = await api.updateSettings({
      projectPath: snapshot.projectPath,
      recentProjects: snapshot.recentProjects,
      projectDisplayNames: snapshot.projectDisplayNames,
      skillTogglesByProject: snapshot.skillTogglesByProject,
    })
    if (!result.ok) throw new Error(result.error)
    return canonicalPath
  } catch (err) {
    if (previousPrefs?.model !== undefined) {
      await api.setProjectPreferences(path, { model: previousPrefs.model }).catch(() => undefined)
    }
    throw err
  }
}
