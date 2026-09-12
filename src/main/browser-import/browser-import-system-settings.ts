import { openExternal } from '../desktop-ui'

const MACOS_FULL_DISK_ACCESS_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles'

export function browserImportFullDiskAccessSettingsUrl(platform: NodeJS.Platform) {
  return platform === 'darwin' ? MACOS_FULL_DISK_ACCESS_SETTINGS_URL : undefined
}

/** Opens one app-fixed operating-system destination. No renderer URL crosses this boundary. */
export async function openBrowserImportFullDiskAccessSettings(
  platform: NodeJS.Platform = process.platform,
) {
  const url = browserImportFullDiskAccessSettingsUrl(platform)
  if (!url) return false
  await openExternal(url)
  return true
}
