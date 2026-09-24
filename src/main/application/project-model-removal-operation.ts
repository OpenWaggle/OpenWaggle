import fs from 'node:fs/promises'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { getProjectPreferencesStrict, setProjectPreferences } from '../config/project-config'
import { SettingsService, type SettingsServiceShape } from '../services/settings-service'

/**
 * Removes one project's stored model. The project directory may already be gone — moved or deleted
 * outside OpenWaggle — so the recorded alias identity is authoritative and realpath is only a
 * fallback; canonicalization never mutates an unrelated project.
 */
function clearProjectModelEntry(
  settings: SettingsServiceShape,
  projectPath: string,
  tombstone: boolean,
) {
  if (tombstone && settings.setProjectModel) return settings.setProjectModel(projectPath, null)
  if (!tombstone && settings.removeProjectModel) return settings.removeProjectModel(projectPath)
  return Effect.gen(function* () {
    const current = yield* settings.get()
    const rest = { ...current.selectedModelsByProject }
    if (tombstone) {
      rest[projectPath] = ''
    } else {
      delete rest[projectPath]
    }
    yield* settings.update({ selectedModelsByProject: rest })
  })
}

/**
 * Reads the candidate's legacy file state and retires a legacy model through the central write.
 * Returns whether the entry must be suppressed with a tombstone instead of a plain delete: the
 * file was unreadable (state unknown), the strip rewrite failed, or the strip was skipped because
 * the legacy migration failed (absence could not be confirmed).
 */
function retireLegacyFileModel(candidate: string): Effect.Effect<boolean, never> {
  return Effect.gen(function* () {
    const fileRead = yield* Effect.promise(() =>
      getProjectPreferencesStrict(candidate)
        .then((prefs) => ({ readable: true as const, model: prefs?.model }))
        .catch(() => ({ readable: false as const, model: undefined })),
    )
    if (!fileRead.readable) return true
    if (fileRead.model === undefined) return false
    // A rejected rewrite is not fatal: the re-read below decides whether absence was achieved.
    yield* Effect.promise(() => setProjectPreferences(candidate, {}).catch(() => undefined))
    // The central write resolves even when the legacy migration failed and the file kept the
    // model, so confirm the strip actually removed it before choosing a plain delete.
    const after = yield* Effect.promise(() =>
      getProjectPreferencesStrict(candidate)
        .then((prefs) => ({ readable: true as const, model: prefs?.model }))
        .catch(() => ({ readable: false as const, model: undefined })),
    )
    // An unreadable confirmation means absence was not proven — keep the tombstone.
    if (!after.readable) return true
    return after.model !== undefined
  })
}

/**
 * Resolves one project reference to its stored identity: the recorded alias mapping when present,
 * otherwise the realpath of the directory (or the raw path when the directory is gone).
 */
function resolveReferenceIdentity(
  settings: SettingsServiceShape,
  referencePath: string,
): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    if (settings.resolveProjectPathAlias) {
      const recorded = yield* settings.resolveProjectPathAlias(referencePath)
      if (recorded !== undefined) return recorded
    }
    return yield* Effect.promise(() => fs.realpath(referencePath).catch(() => referencePath))
  })
}

export function removeProjectModelOperation(rawProjectPath: unknown, rawRemainingPaths?: unknown) {
  return Effect.gen(function* () {
    const projectPath = typeof rawProjectPath === 'string' ? rawProjectPath.trim() : ''
    if (!projectPath || !path.isAbsolute(projectPath)) {
      return yield* Effect.fail(new Error('Project path is required.'))
    }
    const settings = yield* SettingsService
    // The recorded alias identity is authoritative for a saved reference: it is the canonical key
    // the project's reads and writes actually used. realpath is only consulted when nothing was
    // recorded, so a retargeted symlink can never make removal mutate an unrelated project, and a
    // deleted directory still resolves through the map instead of the raw alias.
    const recordedCanonical = settings.resolveProjectPathAlias
      ? yield* settings.resolveProjectPathAlias(projectPath)
      : undefined
    const canonicalPath =
      recordedCanonical ??
      (yield* Effect.promise(() => fs.realpath(projectPath).catch(() => projectPath)))
    // While another surviving project reference resolves to the same identity — an upgraded
    // profile can list both the alias and its canonical path — the model must stay for it.
    const remainingPaths = Array.isArray(rawRemainingPaths)
      ? rawRemainingPaths.filter(
          (candidate): candidate is string => typeof candidate === 'string' && !!candidate,
        )
      : []
    for (const remaining of remainingPaths) {
      if (remaining === projectPath) continue
      const remainingIdentity = yield* resolveReferenceIdentity(settings, remaining)
      if (remainingIdentity === canonicalPath) {
        // A surviving reference shares this identity: keep the model for it and drop only the
        // removed reference's alias record.
        if (settings.removeProjectPathAlias) {
          yield* settings.removeProjectPathAlias(projectPath)
        }
        return canonicalPath
      }
    }
    // A legacy file model must not survive removal: unreadable or non-rewritable files suppress
    // with a tombstone so the legacy fallback can never restore the removed model.
    const tombstone = yield* retireLegacyFileModel(canonicalPath)
    yield* clearProjectModelEntry(settings, canonicalPath, tombstone)
    if (settings.removeProjectPathAlias) {
      yield* settings.removeProjectPathAlias(projectPath)
    }
    return canonicalPath
  })
}
