/**
 * Source-control Settings (ADR 0048): the user-wide and private per-project Change request open
 * destination, the user's provider choices per Source control host, providers learned from a
 * remote's refs, the Provider account and change-request repository remembered per repository,
 * and the user's decisions on projects' shared host declarations. Persisted validation rejects
 * malformed values, so these resolvers only fill defaults for absent keys.
 */
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import {
  SETTINGS_KEY_CHANGE_REQUEST_OPEN_DESTINATION,
  SETTINGS_KEY_CHANGE_REQUEST_OPEN_DESTINATION_BY_PROJECT,
  SETTINGS_KEY_SOURCE_CONTROL_CHANGE_REQUEST_REPOSITORIES,
  SETTINGS_KEY_SOURCE_CONTROL_DETECTED_HOST_PROVIDERS,
  SETTINGS_KEY_SOURCE_CONTROL_HOST_PROVIDERS,
  SETTINGS_KEY_SOURCE_CONTROL_PROJECT_DECLARATIONS,
  SETTINGS_KEY_SOURCE_CONTROL_REPOSITORY_ACCOUNTS,
} from './keys'
import { appendChangedSetting, type SettingsPatchWrite } from './settings-patch-writes'

type SourceControlSettings = Pick<
  Settings,
  | 'changeRequestOpenDestination'
  | 'changeRequestOpenDestinationByProject'
  | 'sourceControlHostProviders'
  | 'sourceControlDetectedHostProviders'
  | 'sourceControlRepositoryAccounts'
  | 'sourceControlChangeRequestRepositories'
  | 'sourceControlProjectDeclarations'
>

const SOURCE_CONTROL_SETTING_KEYS = {
  changeRequestOpenDestination: SETTINGS_KEY_CHANGE_REQUEST_OPEN_DESTINATION,
  changeRequestOpenDestinationByProject: SETTINGS_KEY_CHANGE_REQUEST_OPEN_DESTINATION_BY_PROJECT,
  sourceControlHostProviders: SETTINGS_KEY_SOURCE_CONTROL_HOST_PROVIDERS,
  sourceControlDetectedHostProviders: SETTINGS_KEY_SOURCE_CONTROL_DETECTED_HOST_PROVIDERS,
  sourceControlRepositoryAccounts: SETTINGS_KEY_SOURCE_CONTROL_REPOSITORY_ACCOUNTS,
  sourceControlChangeRequestRepositories: SETTINGS_KEY_SOURCE_CONTROL_CHANGE_REQUEST_REPOSITORIES,
  sourceControlProjectDeclarations: SETTINGS_KEY_SOURCE_CONTROL_PROJECT_DECLARATIONS,
} as const satisfies Record<keyof SourceControlSettings, string>

const SOURCE_CONTROL_SETTING_NAMES = Object.keys(SOURCE_CONTROL_SETTING_KEYS).filter(
  (name): name is keyof SourceControlSettings => Object.hasOwn(SOURCE_CONTROL_SETTING_KEYS, name),
)

function storedOrDefault<K extends keyof SourceControlSettings>(
  storedSettings: Readonly<Record<string, unknown>>,
  name: K,
  isValue: (value: unknown) => value is SourceControlSettings[K],
): SourceControlSettings[K] {
  const key = SOURCE_CONTROL_SETTING_KEYS[name]
  const stored = Object.hasOwn(storedSettings, key) ? storedSettings[key] : undefined
  return isValue(stored) ? stored : DEFAULT_SETTINGS[name]
}

function isRecord<T>(value: unknown): value is Readonly<Record<string, T>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDestination(value: unknown): value is Settings['changeRequestOpenDestination'] {
  return value === null || value === 'inspector' || value === 'website'
}

/** Persisted validation already proved the shape; absent keys read as their defaults. */
export function resolveStoredSourceControlSettings(
  storedSettings: Readonly<Record<string, unknown>>,
): SourceControlSettings {
  return {
    changeRequestOpenDestination: storedOrDefault(
      storedSettings,
      'changeRequestOpenDestination',
      isDestination,
    ),
    changeRequestOpenDestinationByProject: storedOrDefault(
      storedSettings,
      'changeRequestOpenDestinationByProject',
      isRecord,
    ),
    sourceControlHostProviders: storedOrDefault(
      storedSettings,
      'sourceControlHostProviders',
      isRecord,
    ),
    sourceControlDetectedHostProviders: storedOrDefault(
      storedSettings,
      'sourceControlDetectedHostProviders',
      isRecord,
    ),
    sourceControlRepositoryAccounts: storedOrDefault(
      storedSettings,
      'sourceControlRepositoryAccounts',
      isRecord,
    ),
    sourceControlChangeRequestRepositories: storedOrDefault(
      storedSettings,
      'sourceControlChangeRequestRepositories',
      isRecord,
    ),
    sourceControlProjectDeclarations: storedOrDefault(
      storedSettings,
      'sourceControlProjectDeclarations',
      isRecord,
    ),
  }
}

export function resolveNextSourceControlSettings(
  current: Settings,
  partial: Partial<Settings>,
): SourceControlSettings {
  return {
    changeRequestOpenDestination:
      partial.changeRequestOpenDestination === undefined
        ? current.changeRequestOpenDestination
        : partial.changeRequestOpenDestination,
    changeRequestOpenDestinationByProject:
      partial.changeRequestOpenDestinationByProject ??
      current.changeRequestOpenDestinationByProject,
    sourceControlHostProviders:
      partial.sourceControlHostProviders ?? current.sourceControlHostProviders,
    sourceControlDetectedHostProviders:
      partial.sourceControlDetectedHostProviders ?? current.sourceControlDetectedHostProviders,
    sourceControlRepositoryAccounts:
      partial.sourceControlRepositoryAccounts ?? current.sourceControlRepositoryAccounts,
    sourceControlChangeRequestRepositories:
      partial.sourceControlChangeRequestRepositories ??
      current.sourceControlChangeRequestRepositories,
    sourceControlProjectDeclarations:
      partial.sourceControlProjectDeclarations ?? current.sourceControlProjectDeclarations,
  }
}

export function appendSourceControlSettingsWrites(
  writes: SettingsPatchWrite[],
  partial: Partial<Settings>,
  next: Settings,
) {
  for (const name of SOURCE_CONTROL_SETTING_NAMES) {
    appendChangedSetting(
      writes,
      partial[name] !== undefined,
      SOURCE_CONTROL_SETTING_KEYS[name],
      next[name],
    )
  }
}
