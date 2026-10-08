import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { SourceControlSettingsAccess } from './source-control-settings-access'

/** Read-only defaults until the runtime configures the real access, as in isolated unit tests. */
const DEFAULT_ACCESS: SourceControlSettingsAccess = {
  read: async () => DEFAULT_SETTINGS,
  patch: async () => undefined,
}

let configuredAccess: SourceControlSettingsAccess | null = null

/** Installed once the app runtime exists, in both the desktop window and the Session Host. */
export function configureSourceControlSettingsAccess(access: SourceControlSettingsAccess | null) {
  configuredAccess = access
}

export function sourceControlSettingsAccess(): SourceControlSettingsAccess {
  return configuredAccess ?? DEFAULT_ACCESS
}
