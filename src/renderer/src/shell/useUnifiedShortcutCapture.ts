import type { BrowserPreviewKeyEvent } from '@shared/types/browser-preview'
import type { ProjectAction } from '@shared/types/project-actions'
import type { ExtensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import {
  type ShortcutBinding,
  type ShortcutCommand,
  type ShortcutRules,
  shortcutBindingKey,
} from '@shared/types/shortcuts'
import { typesAltGraphCharacter } from '@shared/utils/altgraph-character'
import { EXTENSION_PANEL_SHORTCUT_WHEN } from '@shared/utils/extension-panel-shortcuts'
import {
  orderedProjectActionShortcuts,
  projectActionWhenMatches,
} from '@shared/utils/project-action-shortcuts'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { api } from '@/shared/lib/ipc'
import {
  keyboardLayoutKey,
  noteKeyboardLayoutKeyPress,
  trackKeyboardLayout,
} from '@/shared/lib/keyboard-layout'
import { usesAppleShortcuts } from '@/shared/lib/shortcut-display'
import {
  type ExtensionPanelShortcut,
  hasModifierFreeUnifiedShortcut,
  isShortcutEditorTarget,
  isTextEditingShortcutTarget,
  resolveUnifiedShortcut,
  workspaceShortcutContext,
} from './unified-shortcut-resolver'

export type BuiltInShortcutHandlers = Readonly<Record<ShortcutCommand, () => void>>

interface UnifiedShortcutCaptureOptions {
  readonly actions: readonly ProjectAction[]
  readonly builtInRules: ShortcutRules
  /** Bindings of extension side panels that are available now; others pass the key through. */
  readonly extensionPanels?: readonly ExtensionPanelShortcut[]
  readonly handlers: BuiltInShortcutHandlers
  readonly onRunProjectAction: (action: ProjectAction) => void
  readonly onToggleExtensionPanel?: (surfaceId: ExtensionRightPanelSurfaceId) => void
  readonly shouldHandleBuiltIn?: (command: ShortcutCommand) => boolean
  readonly terminalOpen: boolean
}

/** A field, editor, or terminal that receives typed characters. */
const TYPING_TARGET = 'input, textarea, select, [contenteditable="true"], [data-terminal-pane]'

/**
 * A character typed with AltGr into a field or terminal belongs to it, not to a Ctrl+Alt
 * shortcut. Elsewhere nothing would be typed, so the shortcut still runs.
 */
function typesAltGraphText(event: KeyboardEvent) {
  // The first key press starts reading the layout; until it arrives the layout-free rule applies.
  trackKeyboardLayout()
  noteKeyboardLayoutKeyPress(event)
  if (!(event.target instanceof Element) || event.target.closest(TYPING_TARGET) === null) {
    return false
  }
  return typesAltGraphCharacter({
    key: event.key,
    code: event.code,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey,
    shift: event.shiftKey,
    altGraph: event.getModifierState('AltGraph'),
    applePlatform: usesAppleShortcuts(),
    layoutKey: keyboardLayoutKey(event.code),
  })
}

function consumeShortcutEvent(event: KeyboardEvent) {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

function browserPreviewShortcutContext(terminalOpen: boolean) {
  return {
    terminalFocus: false,
    terminalOpen,
    previewFocus: true,
    previewOpen: true,
    modelPickerOpen: false,
  }
}

const NO_EXTENSION_PANELS: readonly ExtensionPanelShortcut[] = []

/** Native previews only need the chord registry; renderer context remains the source of truth. */
export function browserPreviewShortcutBindings(
  builtInRules: ShortcutRules,
  actions: readonly ProjectAction[],
  terminalOpen: boolean,
  extensionPanels: readonly ExtensionPanelShortcut[] = NO_EXTENSION_PANELS,
): readonly ShortcutBinding[] {
  const context = browserPreviewShortcutContext(terminalOpen)
  const rules = [
    ...builtInRules,
    ...orderedProjectActionShortcuts(actions).map((entry) => entry.rule),
    ...extensionPanels.map((panel) => ({
      shortcut: panel.shortcut,
      when: EXTENSION_PANEL_SHORTCUT_WHEN,
    })),
  ]
  const seen = new Set<string>()
  return rules.flatMap((rule) => {
    if (!projectActionWhenMatches(rule.when, context)) return []
    const identity = shortcutBindingKey(rule.shortcut)
    if (seen.has(identity)) return []
    seen.add(identity)
    return [rule.shortcut]
  })
}

/** One capture listener arbitrates every configurable command before xterm encodes the key. */
/**
 * Sends the browser preview its shortcut bindings when they change. Startup rebuilt these inputs
 * about seven times with the same result and sent the same list each time (boot fetch dedupe);
 * an unchanged list is not sent again.
 */
function useBrowserPreviewShortcutBindingSync(
  ...inputs: Parameters<typeof browserPreviewShortcutBindings>
) {
  const sentBindingsRef = useRef<string | null>(null)
  const [builtInRules, actions, terminalOpen, extensionPanels] = inputs
  useEffect(() => {
    const bindings = browserPreviewShortcutBindings(
      builtInRules,
      actions,
      terminalOpen,
      extensionPanels,
    )
    const json = JSON.stringify(bindings)
    if (json === sentBindingsRef.current) return
    sentBindingsRef.current = json
    void api.setBrowserPreviewShortcutBindings(bindings).catch((error: unknown) => {
      sentBindingsRef.current = null
      console.error('[shortcuts] Failed to register browser preview bindings.', error)
    })
  }, [actions, builtInRules, terminalOpen, extensionPanels])
}

export function useUnifiedShortcutCapture(options: UnifiedShortcutCaptureOptions) {
  const handlersRef = useRef(options.handlers)
  const onRunProjectActionRef = useRef(options.onRunProjectAction)
  const onToggleExtensionPanelRef = useRef(options.onToggleExtensionPanel)
  const extensionPanels = options.extensionPanels ?? NO_EXTENSION_PANELS
  const extensionPanelsRef = useRef(extensionPanels)
  const shouldHandleBuiltInRef = useRef(options.shouldHandleBuiltIn)
  const builtInRulesRef = useRef(options.builtInRules)
  const actionsRef = useRef(options.actions)
  const terminalOpenRef = useRef(options.terminalOpen)
  const hasModifierFreeRef = useRef(false)
  useLayoutEffect(() => {
    handlersRef.current = options.handlers
    onRunProjectActionRef.current = options.onRunProjectAction
    onToggleExtensionPanelRef.current = options.onToggleExtensionPanel
    extensionPanelsRef.current = extensionPanels
    shouldHandleBuiltInRef.current = options.shouldHandleBuiltIn
    builtInRulesRef.current = options.builtInRules
    actionsRef.current = options.actions
    terminalOpenRef.current = options.terminalOpen
    hasModifierFreeRef.current = hasModifierFreeUnifiedShortcut(
      options.builtInRules,
      options.actions,
      extensionPanels,
    )
  })

  useBrowserPreviewShortcutBindingSync(
    options.builtInRules,
    options.actions,
    options.terminalOpen,
    extensionPanels,
  )

  useEffect(() => {
    const suppressedKeyUps = new Set<string>()
    const dispatchMatch = (
      event: Pick<BrowserPreviewKeyEvent, 'repeat'>,
      getMatch: () => ReturnType<typeof resolveUnifiedShortcut>,
    ) => {
      const match = getMatch()
      if (match === null || event.repeat) return
      if (
        match.kind === 'builtin' &&
        shouldHandleBuiltInRef.current?.(match.rule.command) === false
      ) {
        return
      }
      if (match.kind === 'project') {
        onRunProjectActionRef.current(match.action)
        return
      }
      if (match.kind === 'extension-panel') {
        onToggleExtensionPanelRef.current?.(match.surfaceId)
        return
      }
      handlersRef.current[match.rule.command]()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isShortcutEditorTarget(event) || typesAltGraphText(event)) return
      const modifierFreeEvent = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
      if (
        modifierFreeEvent &&
        (!hasModifierFreeRef.current || isTextEditingShortcutTarget(event))
      ) {
        return
      }
      const match = resolveUnifiedShortcut(
        event,
        builtInRulesRef.current,
        actionsRef.current,
        usesAppleShortcuts(),
        () => workspaceShortcutContext(event),
        extensionPanelsRef.current,
      )
      if (match === null) return
      if (
        match.kind === 'builtin' &&
        shouldHandleBuiltInRef.current?.(match.rule.command) === false
      ) {
        return
      }
      if (event.code.length > 0) suppressedKeyUps.add(event.code)
      consumeShortcutEvent(event)
      dispatchMatch(event, () => match)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!suppressedKeyUps.delete(event.code)) return
      consumeShortcutEvent(event)
    }
    const clearHeldKeys = () => suppressedKeyUps.clear()
    const onBrowserPreviewKeyEvent = (event: BrowserPreviewKeyEvent) => {
      if (event.type !== 'keydown') return
      dispatchMatch(event, () =>
        resolveUnifiedShortcut(
          event,
          builtInRulesRef.current,
          actionsRef.current,
          usesAppleShortcuts(),
          () => browserPreviewShortcutContext(terminalOpenRef.current),
          extensionPanelsRef.current,
        ),
      )
    }
    const unsubscribeBrowserPreview = api.onBrowserPreviewKeyEvent(onBrowserPreviewKeyEvent)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', clearHeldKeys)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', clearHeldKeys)
      unsubscribeBrowserPreview()
      clearHeldKeys()
    }
  }, [])
}
