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
 * Tracks a write chain under a key without displacing a different chain already tracked there:
 * when an alias chain re-keys onto a canonical path that has its own pending write, a removal
 * addressed by the canonical path must wait for both, or the displaced write could land after the
 * deletion and recreate the entry.
 */
function trackPendingWrite(key: string, chain: Promise<void>) {
  const existing = pendingProjectPreferenceWrites.get(key)
  if (!existing || existing === chain) {
    pendingProjectPreferenceWrites.set(key, chain)
    return
  }
  const merged = Promise.allSettled([existing, chain]).then(() => undefined)
  pendingProjectPreferenceWrites.set(key, merged)
  void merged.finally(() => {
    if (pendingProjectPreferenceWrites.get(key) === merged)
      pendingProjectPreferenceWrites.delete(key)
  })
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
  // Skill and agent-definition toggles persist through their own Host APIs without updating this
  // store, so the renderer copies can be stale; re-keying them from the store would send the stale
  // maps back and revert every toggle changed since load. The Host's maps are authoritative.
  const hostSettings = await api.getSettings()
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
    skillTogglesByProject: rekeyNested({ ...hostSettings.skillTogglesByProject }),
    agentDefinitionTogglesByProject: rekeyNested({
      ...hostSettings.agentDefinitionTogglesByProject,
    }),
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
          trackPendingWrite(canonicalPath, stillPending)
        }
        if (removingProjectPaths.has(projectPath)) {
          removingProjectPaths.add(canonicalPath)
          removalMarkerCopies.set(canonicalPath, projectPath)
        }
      } else {
        // Renderer state still names the alias (this caller does not reconcile), so the chain is
        // tracked under both identities and a removal addressed by either one waits for it.
        trackPendingWrite(canonicalPath, pendingProjectPreferenceWrites.get(projectPath) ?? tracked)
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
export function removeProjectModelTracked<T extends string | { readonly canonicalPath: string }>(
  projectPath: string,
  perform: () => Promise<T>,
): Promise<T> {
  removingProjectPaths.add(projectPath)
  const pending = pendingProjectPreferenceWrites.get(projectPath) ?? Promise.resolve()
  return pending
    .catch(() => undefined)
    .then(perform)
    .then((result) => {
      const canonicalPath = typeof result === 'string' ? result : result.canonicalPath
      // The re-key may have copied the removal marker onto the canonical identity.
      clearRemovalMarkerCopies(projectPath)
      removingProjectPaths.delete(projectPath)
      if (canonicalPath) removingProjectPaths.delete(canonicalPath)
      return result
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

/** The project-reference fields a removal strips and, on failure, puts back. */
type ProjectReferences = Pick<
  Settings,
  'projectPath' | 'recentProjects' | 'projectDisplayNames' | 'skillTogglesByProject'
>

function withoutKey<V>(record: Readonly<Record<string, V>>, key: string): Record<string, V> {
  const { [key]: _removed, ...rest } = record
  return rest
}

/** Re-inserts one removed project's reference entries into the Host's current reference state. */
function restoredReferences(
  path: string,
  before: ProjectReferences,
  current: ProjectReferences,
): ProjectReferences {
  const recentProjects = [...current.recentProjects]
  const originalIndex = before.recentProjects.indexOf(path)
  if (originalIndex >= 0 && !recentProjects.includes(path)) {
    recentProjects.splice(Math.min(originalIndex, recentProjects.length), 0, path)
  }
  const displayName = before.projectDisplayNames[path]
  const skillToggles = before.skillTogglesByProject[path]
  return {
    projectPath:
      before.projectPath === path && current.projectPath === null ? path : current.projectPath,
    recentProjects,
    projectDisplayNames:
      displayName === undefined
        ? current.projectDisplayNames
        : { ...current.projectDisplayNames, [path]: displayName },
    skillTogglesByProject:
      skillToggles === undefined
        ? current.skillTogglesByProject
        : { ...current.skillTogglesByProject, [path]: skillToggles },
  }
}

/**
 * Removes one project's references and then its stored model, as one locked step.
 *
 * The reference fields are read from the Host rather than the renderer store: skill toggles
 * persist through their own Host API, so a store copy would revert them for every other project.
 *
 * References go first so the renderer never has to write a model back. The Host removal compensates
 * its own partial failures under the identity it deleted by (the recorded alias target, which a
 * renderer-side preference read cannot reproduce once a symlink is retargeted or the directory is
 * gone). If the Host removal fails, the references are put back and the project stays visible for
 * a retry.
 */
export async function removeModelAndReferences(
  path: string,
): Promise<{ canonicalPath: string; references: ProjectReferences }> {
  const before = await api.getSettings()
  const references: ProjectReferences = {
    projectPath: before.projectPath === path ? null : before.projectPath,
    recentProjects: before.recentProjects.filter((projectPath) => projectPath !== path),
    projectDisplayNames: withoutKey(before.projectDisplayNames, path),
    skillTogglesByProject: withoutKey(before.skillTogglesByProject, path),
  }
  // Surviving references that resolve to the same identity keep the stored model alive.
  const remainingReferences = [
    ...references.recentProjects,
    ...(references.projectPath ? [references.projectPath] : []),
  ]
  const result = await api.updateSettings(references)
  if (!result.ok) throw new Error(result.error)
  try {
    const canonicalPath = await api.removeProjectModel(path, remainingReferences)
    return { canonicalPath, references }
  } catch (err) {
    await api
      .getSettings()
      .then((current) => api.updateSettings(restoredReferences(path, before, current)))
      .catch(() => undefined)
    throw err
  }
}
