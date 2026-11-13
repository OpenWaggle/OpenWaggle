import type {
  BrowserPreviewKeyEvent,
  BrowserPreviewShortcutBindings,
  BrowserPreviewShortcutEvent,
} from '@shared/types/browser-preview'
import { typesAltGraphCharacter } from '@shared/utils/altgraph-character'
import { projectActionShortcutMatches } from '@shared/utils/project-action-shortcuts'

/**
 * One key event inside a preview page, as the shell reports it. Electron's `Input` has this shape
 * as is; Electrobun builds it from the page's `KeyboardEvent`.
 */
export interface BrowserPreviewKeyInput {
  readonly type: string
  readonly key: string
  readonly code: string
  readonly location: number
  readonly alt: boolean
  readonly control: boolean
  readonly meta: boolean
  readonly shift: boolean
  readonly isComposing: boolean
  readonly isAutoRepeat: boolean
}

export type NativeBrowserPreviewShortcut =
  | BrowserPreviewShortcutEvent['action']
  | 'reload'
  | 'back'
  | 'forward'

/** What the shell does with one key event of a preview page. */
export type BrowserPreviewKeyDecision =
  /** The page gets it. */
  | { readonly kind: 'page' }
  /** The page does not get it, and nothing else happens. */
  | { readonly kind: 'swallow' }
  /** The owner's shortcut resolver claimed it: forward it, and swallow its key up too. */
  | { readonly kind: 'claim'; readonly event: BrowserPreviewKeyEvent | null }
  /** The key up of a claimed key: forward it. */
  | { readonly kind: 'release'; readonly event: BrowserPreviewKeyEvent | null }
  /** One of the preview's own shortcuts. */
  | { readonly kind: 'shortcut'; readonly shortcut: NativeBrowserPreviewShortcut }

function isPrimaryModifier(input: BrowserPreviewKeyInput, isMac: boolean) {
  return isMac ? input.meta && !input.control : input.control && !input.meta
}

function nativeBrowserPreviewShortcutForChord(input: BrowserPreviewKeyInput, isMac: boolean) {
  if (input.isComposing || input.shift) return null

  const key = input.key.toLowerCase()
  const primary = isPrimaryModifier(input, isMac)
  if (primary && !input.alt) {
    if (key === 'l') return 'focus-location' satisfies NativeBrowserPreviewShortcut | null
    if (key === 'r') return 'reload' satisfies NativeBrowserPreviewShortcut | null
    if (key === 'w') return 'close' satisfies NativeBrowserPreviewShortcut | null
  }
  if (input.alt && !input.control && !input.meta) {
    if (key === 'arrowleft') return 'back' satisfies NativeBrowserPreviewShortcut | null
    if (key === 'arrowright') return 'forward' satisfies NativeBrowserPreviewShortcut | null
  }
  return null
}

export function browserPreviewShortcutForInput(input: BrowserPreviewKeyInput, isMac: boolean) {
  if (input.type !== 'keyDown' || input.isAutoRepeat) {
    return null
  }

  return nativeBrowserPreviewShortcutForChord(input, isMac)
}

export function isBrowserPreviewNativeShortcutChord(input: BrowserPreviewKeyInput, isMac: boolean) {
  return nativeBrowserPreviewShortcutForChord(input, isMac) !== null
}

export function browserPreviewShortcutBindingsMatchInput(
  input: BrowserPreviewKeyInput,
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

export function browserPreviewInputKeyIdentity(input: BrowserPreviewKeyInput) {
  return input.code.length > 0
    ? `code:${input.code}`
    : `key:${input.key}:location:${String(input.location)}`
}

export function browserPreviewKeyEventForInput(previewId: string, input: BrowserPreviewKeyInput) {
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
  } satisfies BrowserPreviewKeyEvent | null
}

/**
 * Decides one key event of a preview page: the owner's claimed chords first, then the preview's
 * own shortcuts. `claimedKeys` holds the keys whose key down was claimed, so their key up is
 * forwarded too and never reaches the page alone.
 */
export function decideBrowserPreviewKeyInput(
  options: {
    readonly previewId: string
    readonly bindings: BrowserPreviewShortcutBindings
    readonly claimedKeys: Set<string>
    readonly isMac: boolean
  },
  input: BrowserPreviewKeyInput,
) {
  const { previewId, bindings, claimedKeys, isMac } = options
  const keyIdentity = browserPreviewInputKeyIdentity(input)
  if (input.type === 'keyUp') {
    if (claimedKeys.delete(keyIdentity)) {
      return {
        kind: 'release',
        event: browserPreviewKeyEventForInput(previewId, input),
      } satisfies BrowserPreviewKeyDecision
    }
    return (
      isBrowserPreviewNativeShortcutChord(input, isMac) ? { kind: 'swallow' } : { kind: 'page' }
    ) satisfies BrowserPreviewKeyDecision
  }
  if (input.type !== 'keyDown') return { kind: 'page' } satisfies BrowserPreviewKeyDecision

  if (browserPreviewShortcutBindingsMatchInput(input, bindings, isMac)) {
    claimedKeys.add(keyIdentity)
    return {
      kind: 'claim',
      event: browserPreviewKeyEventForInput(previewId, input),
    } satisfies BrowserPreviewKeyDecision
  }

  const shortcut = browserPreviewShortcutForInput(input, isMac)
  if (shortcut) return { kind: 'shortcut', shortcut } satisfies BrowserPreviewKeyDecision
  return (
    isBrowserPreviewNativeShortcutChord(input, isMac) ? { kind: 'swallow' } : { kind: 'page' }
  ) satisfies BrowserPreviewKeyDecision
}
