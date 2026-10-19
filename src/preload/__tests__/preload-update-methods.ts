import type { OpenWaggleApi } from '@shared/types/openwaggle-api'

/** The auto-updater and app-version methods of the preload bridge. */
export const PRELOAD_UPDATE_METHODS = [
  'checkForUpdates',
  'checkSessionWorktree',
  'installUpdate',
  'installUpdateNow',
  'getUpdateStatus',
  'getAppVersion',
  'getDesktopNativeAdmissionIssue',
  'recoverDesktopNativeAdmission',
  'onUpdateStatus',
] as const satisfies readonly (keyof OpenWaggleApi)[]
