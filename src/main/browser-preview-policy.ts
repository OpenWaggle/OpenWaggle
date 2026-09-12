import { isBrowserPreviewUrl, normalizeBrowserPreviewUrl } from '@shared/schemas/browser-preview'
import type {
  BrowserPreviewKeyEvent,
  BrowserPreviewShortcutBindings,
  BrowserPreviewShortcutEvent,
} from '@shared/types/browser-preview'
import { projectActionShortcutMatches } from '@shared/utils/project-action-shortcuts'
import type { Input } from 'electron'
import {
  browserPreviewWebPreferencesForProfile,
  installBrowserPreviewSessionPolicy,
} from './browser-preview-profile-session'
import { SECURE_WEB_PREFERENCES } from './security/electron-security'

const MAX_ERROR_DESCRIPTION_LENGTH = 1_024

export const MAX_PREVIEWS_PER_OWNER = 8
export const MAX_PREVIEWS_PER_RENDERER = 32
export const MAX_TITLE_LENGTH = 512
export const ABORTED_LOAD_ERROR_CODE = -3

type NativeBrowserPreviewShortcut =
  | BrowserPreviewShortcutEvent['action']
  | 'reload'
  | 'back'
  | 'forward'

export function boundedBrowserPreviewText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

export const installPreviewSessionPolicy = installBrowserPreviewSessionPolicy

function isPrimaryModifier(input: Input, isMac: boolean) {
  return isMac ? input.meta && !input.control : input.control && !input.meta
}

function nativeBrowserPreviewShortcutForChord(
  input: Input,
  isMac: boolean,
): NativeBrowserPreviewShortcut | null {
  if (input.isComposing || input.shift) return null

  const key = input.key.toLowerCase()
  const primary = isPrimaryModifier(input, isMac)
  if (primary && !input.alt) {
    if (key === 'l') return 'focus-location'
    if (key === 'r') return 'reload'
    if (key === 'w') return 'close'
  }
  if (input.alt && !input.control && !input.meta) {
    if (key === 'arrowleft') return 'back'
    if (key === 'arrowright') return 'forward'
  }
  return null
}

export function browserPreviewShortcutForInput(
  input: Input,
  isMac: boolean,
): NativeBrowserPreviewShortcut | null {
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
) {
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

export function browserPreviewKeyEventForInput(
  previewId: string,
  input: Input,
): BrowserPreviewKeyEvent | null {
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
  }
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
