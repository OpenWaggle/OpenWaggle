import {
  browserPreviewWebPreferencesForProfile,
  installBrowserPreviewSessionPolicy,
} from './browser-preview-profile-session'
import { SECURE_WEB_PREFERENCES } from '../../../security/web-security-policy'

export const installPreviewSessionPolicy = installBrowserPreviewSessionPolicy

export function browserPreviewWebPreferences(profileId: string) {
  return {
    ...SECURE_WEB_PREFERENCES,
    ...browserPreviewWebPreferencesForProfile(profileId),
    webviewTag: false,
    enableWebSQL: false,
    navigateOnDragDrop: false,
    disableDialogs: true,
    disableHtmlFullscreenWindowResize: true,
    devTools: true,
    plugins: false,
    autoplayPolicy: 'user-gesture-required',
    backgroundThrottling: true,
  } as const
}
