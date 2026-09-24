import {
  assertSettingsReady,
  getSettings,
  persistSettingsPatch,
  refreshSettingsStore,
} from '../settings'
import { enqueueSettingsWrite } from './write-queue'

/** Records an aliased project path's canonical identity in the write queue for later removals. */
export function recordProjectPathAliasDurably(alias: string, canonicalPath: string): Promise<void> {
  assertSettingsReady()
  if (alias === canonicalPath) return Promise.resolve()
  return enqueueSettingsWrite(() => {
    if (getSettings().projectPathAliases[alias] === canonicalPath) return Promise.resolve()
    const projectPathAliases = { ...getSettings().projectPathAliases, [alias]: canonicalPath }
    return persistSettingsPatch({ projectPathAliases })
  }, 'project path alias')
}

/** Resolves one aliased project path through the recorded alias map, if present. */
export function lookupProjectPathAlias(alias: string): Promise<string | undefined> {
  assertSettingsReady()
  return refreshSettingsStore().then(() => getSettings().projectPathAliases[alias])
}

/** Deletes one aliased project path's recorded identity inside the write queue. */
export function deleteProjectPathAliasDurably(alias: string): Promise<void> {
  assertSettingsReady()
  return enqueueSettingsWrite(() => {
    if (!Object.hasOwn(getSettings().projectPathAliases, alias)) return Promise.resolve()
    const { [alias]: _removed, ...projectPathAliases } = getSettings().projectPathAliases
    return persistSettingsPatch({ projectPathAliases })
  }, 'project path alias removal')
}
