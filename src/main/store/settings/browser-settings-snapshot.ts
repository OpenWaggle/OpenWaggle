import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import {
  resolveBrowserAutoShowFloatingPreview,
  resolveBrowserDefaultAppearance,
  resolveBrowserDefaultViewport,
  resolveBrowserDefaultZoomFactor,
  resolveBrowserRecordingFrameRate,
} from './browser-preview-defaults-sanitizer'
import {
  resolveBrowserDefaultProfileId,
  sanitizeBrowserProfiles,
} from './browser-profile-sanitizer'
import {
  SETTINGS_KEY_BROWSER_AUTO_SHOW_FLOATING_PREVIEW,
  SETTINGS_KEY_BROWSER_DEFAULT_APPEARANCE,
  SETTINGS_KEY_BROWSER_DEFAULT_PROFILE_ID,
  SETTINGS_KEY_BROWSER_DEFAULT_VIEWPORT,
  SETTINGS_KEY_BROWSER_DEFAULT_ZOOM_FACTOR,
  SETTINGS_KEY_BROWSER_LINK_TARGET,
  SETTINGS_KEY_BROWSER_PROFILES,
  SETTINGS_KEY_BROWSER_RECORDING_FRAME_RATE,
  SETTINGS_KEY_ENABLE_AGENT_BROWSER_ACCESS,
} from './keys'
import { resolveBrowserLinkTarget } from './sanitizers'

function storedValue(storedSettings: Readonly<Record<string, unknown>>, key: string) {
  return Object.hasOwn(storedSettings, key) ? storedSettings[key] : undefined
}

export function resolveStoredBrowserSettings(storedSettings: Readonly<Record<string, unknown>>) {
  const browserProfiles = sanitizeBrowserProfiles(
    storedValue(storedSettings, SETTINGS_KEY_BROWSER_PROFILES),
  )
  const storedAgentBrowserAccess = storedValue(
    storedSettings,
    SETTINGS_KEY_ENABLE_AGENT_BROWSER_ACCESS,
  )
  return {
    browserLinkTarget: resolveBrowserLinkTarget(
      storedValue(storedSettings, SETTINGS_KEY_BROWSER_LINK_TARGET),
    ),
    browserProfiles,
    browserDefaultProfileId: resolveBrowserDefaultProfileId(
      storedValue(storedSettings, SETTINGS_KEY_BROWSER_DEFAULT_PROFILE_ID),
      browserProfiles,
    ),
    browserDefaultViewport: resolveBrowserDefaultViewport(
      storedValue(storedSettings, SETTINGS_KEY_BROWSER_DEFAULT_VIEWPORT),
    ),
    browserDefaultZoomFactor: resolveBrowserDefaultZoomFactor(
      storedValue(storedSettings, SETTINGS_KEY_BROWSER_DEFAULT_ZOOM_FACTOR),
    ),
    browserDefaultAppearance: resolveBrowserDefaultAppearance(
      storedValue(storedSettings, SETTINGS_KEY_BROWSER_DEFAULT_APPEARANCE),
    ),
    browserRecordingFrameRate: resolveBrowserRecordingFrameRate(
      storedValue(storedSettings, SETTINGS_KEY_BROWSER_RECORDING_FRAME_RATE),
    ),
    browserAutoShowFloatingPreview: resolveBrowserAutoShowFloatingPreview(
      storedValue(storedSettings, SETTINGS_KEY_BROWSER_AUTO_SHOW_FLOATING_PREVIEW),
    ),
    enableAgentBrowserAccess:
      typeof storedAgentBrowserAccess === 'boolean'
        ? storedAgentBrowserAccess
        : DEFAULT_SETTINGS.enableAgentBrowserAccess,
  }
}

export function resolveNextBrowserSettings(current: Settings, partial: Partial<Settings>) {
  const browserProfiles =
    partial.browserProfiles === undefined
      ? current.browserProfiles
      : sanitizeBrowserProfiles(partial.browserProfiles)
  return {
    browserLinkTarget:
      partial.browserLinkTarget === undefined
        ? current.browserLinkTarget
        : resolveBrowserLinkTarget(partial.browserLinkTarget),
    browserProfiles,
    browserDefaultProfileId: resolveBrowserDefaultProfileId(
      partial.browserDefaultProfileId ?? current.browserDefaultProfileId,
      browserProfiles,
    ),
    browserDefaultViewport:
      partial.browserDefaultViewport === undefined
        ? current.browserDefaultViewport
        : resolveBrowserDefaultViewport(partial.browserDefaultViewport),
    browserDefaultZoomFactor:
      partial.browserDefaultZoomFactor === undefined
        ? current.browserDefaultZoomFactor
        : resolveBrowserDefaultZoomFactor(partial.browserDefaultZoomFactor),
    browserDefaultAppearance:
      partial.browserDefaultAppearance === undefined
        ? current.browserDefaultAppearance
        : resolveBrowserDefaultAppearance(partial.browserDefaultAppearance),
    browserRecordingFrameRate:
      partial.browserRecordingFrameRate === undefined
        ? current.browserRecordingFrameRate
        : resolveBrowserRecordingFrameRate(partial.browserRecordingFrameRate),
    browserAutoShowFloatingPreview:
      typeof partial.browserAutoShowFloatingPreview === 'boolean'
        ? partial.browserAutoShowFloatingPreview
        : current.browserAutoShowFloatingPreview,
    enableAgentBrowserAccess:
      typeof partial.enableAgentBrowserAccess === 'boolean'
        ? partial.enableAgentBrowserAccess
        : current.enableAgentBrowserAccess,
  }
}
