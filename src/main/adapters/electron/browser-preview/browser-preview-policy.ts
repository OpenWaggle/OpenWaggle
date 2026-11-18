import { isBrowserPreviewUrl, normalizeBrowserPreviewUrl } from '@shared/schemas/browser-preview'
import type {
  BrowserPreviewKeyEvent,
  BrowserPreviewShortcutBindings,
} from '@shared/types/browser-preview'
import { typesAltGraphCharacter } from '@shared/utils/altgraph-character'
import { projectActionShortcutMatches } from '@shared/utils/project-action-shortcuts'
import type { Input } from 'electron'
import {
  browserPreviewWebPreferencesForProfile,
  installBrowserPreviewSessionPolicy,
} from './browser-preview-profile-session'
import { SECURE_WEB_PREFERENCES } from '../../../security/web-security-policy'

const MAX_ERROR_DESCRIPTION_LENGTH = 1_024

export const MAX_PREVIEWS_PER_OWNER = 8
export const MAX_PREVIEWS_PER_RENDERER = 32
export const MAX_TITLE_LENGTH = 512
export const ABORTED_LOAD_ERROR_CODE = -3

export function boundedBrowserPreviewText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

export const installPreviewSessionPolicy = installBrowserPreviewSessionPolicy

function isPrimaryModifier(input: Input, isMac: boolean) {
  return isMac ? input.meta && !input.control : input.control && !input.meta
}

function nativeBrowserPreviewShortcutForChord(input: Input, isMac: boolean) {
  if (input.isComposing || input.shift) return null

  const key = input.key.toLowerCase()
  const primary = isPrimaryModifier(input, isMac)
  if (primary && !input.alt) {
    if (key === 'l') return 'focus-location' as const
    if (key === 'r') return 'reload' as const
    if (key === 'w') return 'close' as const
  }
  if (input.alt && !input.control && !input.meta) {
    if (key === 'arrowleft') return 'back' as const
    if (key === 'arrowright') return 'forward' as const
  }
  return null
}

export function browserPreviewShortcutForInput(input: Input, isMac: boolean) {
  if (input.type !== 'keyDown' || input.isAutoRepeat) {
    return null
  }

  return nativeBrowserPreviewShortcutForChord(input, isMac)
}

export function isBrowserPreviewNativeShortcutChord(input: Input, isMac: boolean) {
  return nativeBrowserPreviewShortcutForChord(input, isMac) !== null
}

export function browserPreviewShortcutBindingsMatchInput(
  input: Input,
  bindings: BrowserPreviewShortcutBindings,
  isMac: boolean,
  platform: NodeJS.Platform = process.platform,
) {
  // A character typed with AltGr in the page is text, not an app shortcut. Electron's input has
  // no AltGr flag; only Windows reports AltGr as Ctrl+Alt.
  const typedWithAltGraph = typesAltGraphCharacter({
    key: input.key,
    code: input.code,
    ctrl: input.control,
    alt: input.alt,
    meta: input.meta,
    shift: input.shift,
    altGraph: platform === 'win32' ? null : false,
    applePlatform: isMac,
  })
  if (typedWithAltGraph) return false
  return bindings.some((binding) =>
    projectActionShortcutMatches(
      {
        key: input.key,
        code: input.code,
        altKey: input.alt,
        ctrlKey: input.control,
        metaKey: input.meta,
        shiftKey: input.shift,
        isComposing: input.isComposing,
      },
      binding,
      isMac,
    ),
  )
}

export function browserPreviewInputKeyIdentity(input: Input) {
  return input.code.length > 0
    ? `code:${input.code}`
    : `key:${input.key}:location:${String(input.location)}`
}

export function browserPreviewKeyEventForInput(previewId: string, input: Input) {
  const type = input.type === 'keyDown' ? 'keydown' : input.type === 'keyUp' ? 'keyup' : null
  if (type === null) return null
  return {
    previewId,
    type,
    key: input.key,
    code: input.code,
    altKey: input.alt,
    ctrlKey: input.control,
    metaKey: input.meta,
    shiftKey: input.shift,
    isComposing: input.isComposing,
    repeat: input.isAutoRepeat,
  } satisfies BrowserPreviewKeyEvent
}

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

export function browserPreviewStateError(code: string, description: string, url: string) {
  return {
    code,
    description: boundedBrowserPreviewText(description, MAX_ERROR_DESCRIPTION_LENGTH),
    url: isBrowserPreviewUrl(url) ? normalizeBrowserPreviewUrl(url) : '',
  }
}
