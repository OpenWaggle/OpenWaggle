import type { SourceControlProviderId } from '@shared/types/change-request'
import type { Settings } from '@shared/types/settings'
import { type SourceControlSettingsPatch, sourceControlHostKey } from '@shared/types/source-control'
import type { SourceControlPreferencesAccess } from './live-resolution-deps'

export type SourceControlSettings = Pick<
  Settings,
  | 'changeRequestOpenDestination'
  | 'changeRequestOpenDestinationByProject'
  | 'sourceControlHostProviders'
  | 'sourceControlDetectedHostProviders'
  | 'sourceControlRepositoryAccounts'
  | 'sourceControlChangeRequestRepositories'
  | 'sourceControlProjectDeclarations'
>

/** Reads and writes the source-control Settings in whichever process owns them. */
export interface SourceControlSettingsAccess {
  readonly read: () => Promise<SourceControlSettings>
  /** Atomically set or remove single entries against the latest stored value. */
  readonly patch: (patch: SourceControlSettingsPatch) => Promise<void>
}

/** The resolution view of the Settings, with the detected-host cache as its only write. */
export function resolutionPreferences(
  access: SourceControlSettingsAccess,
): SourceControlPreferencesAccess {
  return {
    read: async () => {
      const settings = await access.read()
      return {
        userChoices: settings.sourceControlHostProviders,
        detectedHosts: settings.sourceControlDetectedHostProviders,
        projectDeclarations: settings.sourceControlProjectDeclarations,
      }
    },
    rememberDetectedHost: async (host: string, provider: SourceControlProviderId) => {
      const key = sourceControlHostKey(host)
      const current = (await access.read()).sourceControlDetectedHostProviders
      if (current[key] === provider) return
      await access.patch({ sourceControlDetectedHostProviders: { [key]: provider } })
    },
  }
}
