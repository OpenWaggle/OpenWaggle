import { decodeUnknownOrThrow } from '@shared/schema'
import { settingsUpdateSchema } from '@shared/schemas/settings'
import {
  SOURCE_CONTROL_SETTINGS_RECORD_LIMIT,
  type SourceControlSettingsPatch,
} from '@shared/types/source-control'
import type {
  SourceControlSettings,
  SourceControlSettingsAccess,
} from './source-control-settings-access'

/** Apply per-entry changes to one record, dropping the oldest entries past the limit. */
function patchRecord<V>(
  current: Readonly<Record<string, V>>,
  changes: Readonly<Record<string, V | null>>,
): Record<string, V> {
  const next: Record<string, V> = {}
  for (const [key, value] of Object.entries(current)) {
    if (!(key in changes)) next[key] = value
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value !== null) next[key] = value
  }
  const keys = Object.keys(next)
  for (const key of keys.slice(
    0,
    Math.max(0, keys.length - SOURCE_CONTROL_SETTINGS_RECORD_LIMIT),
  )) {
    delete next[key]
  }
  return next
}

function patched<V>(
  current: Readonly<Record<string, V>>,
  changes: Readonly<Record<string, V | null>> | undefined,
) {
  return changes ? patchRecord(current, changes) : undefined
}

/** The Settings update a patch makes against the latest stored source-control Settings. */
export function applySourceControlSettingsPatch(
  current: SourceControlSettings,
  patch: SourceControlSettingsPatch,
): Partial<SourceControlSettings> {
  const byProject = patched(
    current.changeRequestOpenDestinationByProject,
    patch.changeRequestOpenDestinationByProject,
  )
  const hostProviders = patched(
    current.sourceControlHostProviders,
    patch.sourceControlHostProviders,
  )
  const detected = patched(
    current.sourceControlDetectedHostProviders,
    patch.sourceControlDetectedHostProviders,
  )
  const accounts = patched(
    current.sourceControlRepositoryAccounts,
    patch.sourceControlRepositoryAccounts,
  )
  const requestRepositories = patched(
    current.sourceControlChangeRequestRepositories,
    patch.sourceControlChangeRequestRepositories,
  )
  const declarations = patched(
    current.sourceControlProjectDeclarations,
    patch.sourceControlProjectDeclarations,
  )
  return {
    ...(patch.changeRequestOpenDestination !== undefined
      ? { changeRequestOpenDestination: patch.changeRequestOpenDestination }
      : {}),
    ...(byProject ? { changeRequestOpenDestinationByProject: byProject } : {}),
    ...(hostProviders ? { sourceControlHostProviders: hostProviders } : {}),
    ...(detected ? { sourceControlDetectedHostProviders: detected } : {}),
    ...(accounts ? { sourceControlRepositoryAccounts: accounts } : {}),
    ...(requestRepositories ? { sourceControlChangeRequestRepositories: requestRepositories } : {}),
    ...(declarations ? { sourceControlProjectDeclarations: declarations } : {}),
  }
}

/** Raw local Settings reads and writes of the process that owns the database. */
export interface LocalSourceControlSettingsStore {
  readonly read: () => Promise<SourceControlSettings>
  readonly update: (partial: Partial<SourceControlSettings>) => Promise<void>
}

/**
 * Settings access whose patches run one at a time, each against the latest stored value, so no
 * writer in this process loses another's change.
 */
export function createSerialSourceControlSettingsAccess(
  store: LocalSourceControlSettingsStore,
): SourceControlSettingsAccess {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    read: store.read,
    patch: (patch) => {
      const next = tail.then(async () => {
        const current = await store.read()
        const update = applySourceControlSettingsPatch(current, patch)
        // Every Settings read re-validates, so a write it would reject must never be stored.
        decodeUnknownOrThrow(settingsUpdateSchema, update)
        await store.update(update)
      })
      tail = next.catch(() => undefined)
      return next
    },
  }
}
