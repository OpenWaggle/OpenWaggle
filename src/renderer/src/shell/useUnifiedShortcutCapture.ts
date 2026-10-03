import type { BrowserPreviewKeyEvent } from '@shared/types/browser-preview'
import type { ProjectAction } from '@shared/types/project-actions'
import type { ExtensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import {
  type ShortcutBinding,
  type ShortcutCommand,
  type ShortcutRules,
  shortcutBindingKey,
} from '@shared/types/shortcuts'
import { EXTENSION_PANEL_SHORTCUT_WHEN } from '@shared/utils/extension-panel-shortcuts'
import {
  orderedProjectActionShortcuts,
  projectActionWhenMatches,
} from '@shared/utils/project-action-shortcuts'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { api } from '@/shared/lib/ipc'
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

  useEffect(() => {
    const bindings = browserPreviewShortcutBindings(
      options.builtInRules,
      options.actions,
      options.terminalOpen,
      extensionPanels,
    )
    void api.setBrowserPreviewShortcutBindings(bindings).catch((error: unknown) => {
      console.error('[shortcuts] Failed to register browser preview bindings.', error)
    })
  }, [options.actions, options.builtInRules, options.terminalOpen, extensionPanels])

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
      if (isShortcutEditorTarget(event)) return
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
