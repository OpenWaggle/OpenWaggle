import type { ShortcutBindings } from '@shared/types/shortcuts'
import { useEffect, useRef } from 'react'
import { focusPendingRequest } from '@/features/chat/lib'
import { matchesTerminalShortcutBinding } from '@/features/terminal'
import { usesAppleShortcuts } from '@/shared/lib/shortcut-display'

type ShortcutScope = 'application' | 'global'

interface WorkspaceShortcutCaptureOptions {
  readonly shortcutBindings: ShortcutBindings
  readonly toggleSidebar: () => void
  readonly toggleTerminal: () => void
}

function eventTargetsTerminal(event: KeyboardEvent) {
  return event.target instanceof Element && event.target.closest('[data-terminal-pane]') !== null
}

function repeatableMatchEvent(event: KeyboardEvent) {
  if (!event.repeat) return event
  return {
    key: event.key,
    code: event.code,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    isComposing: event.isComposing,
    repeat: false,
  }
}

/** Claims app-global terminal chords before xterm and pairs every consumed release. */
export function useWorkspaceShortcutCapture(options: WorkspaceShortcutCaptureOptions) {
  const suppressedTerminalKeyUpsRef = useRef(new Set<string>())
  const heldTerminalCloseKeyCodesRef = useRef(new Set<string>())

  useEffect(() => {
    const consumeHandledTerminalRelease = (event: KeyboardEvent) => {
      const handledGlobalShortcut = suppressedTerminalKeyUpsRef.current.delete(event.code)
      const heldTerminalClose = heldTerminalCloseKeyCodesRef.current.delete(event.code)
      if (!handledGlobalShortcut && !heldTerminalClose) return
      event.preventDefault()
      event.stopPropagation()
    }
    const clearHeldKeys = () => {
      suppressedTerminalKeyUpsRef.current.clear()
      heldTerminalCloseKeyCodesRef.current.clear()
    }
    window.addEventListener('keyup', consumeHandledTerminalRelease, true)
    window.addEventListener('blur', clearHeldKeys)
    return () => {
      window.removeEventListener('keyup', consumeHandledTerminalRelease, true)
      window.removeEventListener('blur', clearHeldKeys)
      clearHeldKeys()
    }
  }, [])

  useEffect(() => {
    const captureTerminalFocusedGlobalShortcut = (event: KeyboardEvent) => {
      if (event.repeat && heldTerminalCloseKeyCodesRef.current.has(event.code)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (!eventTargetsTerminal(event)) return
      const matchEvent = repeatableMatchEvent(event)
      const applePlatform = usesAppleShortcuts()
      if (
        !event.repeat &&
        matchesTerminalShortcutBinding(
          matchEvent,
          options.shortcutBindings['terminal.close'],
          applePlatform,
        )
      ) {
        if (event.code.length > 0) heldTerminalCloseKeyCodesRef.current.add(event.code)
        // TerminalPanel owns the first press and performs the close. This
        // window-level guard only survives the surface to claim repeats/releases.
        return
      }
      const shortcut = [
        {
          binding: options.shortcutBindings['terminal.toggle'],
          action: options.toggleTerminal,
        },
        {
          binding: options.shortcutBindings['sidebar.toggle'],
          action: options.toggleSidebar,
        },
        {
          binding: options.shortcutBindings['request.focus'],
          action: focusPendingRequest,
        },
      ].find(({ binding }) => matchesTerminalShortcutBinding(matchEvent, binding, applePlatform))
      if (shortcut === undefined) return
      if (event.code.length > 0) suppressedTerminalKeyUpsRef.current.add(event.code)
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) shortcut.action()
    }
    // xterm cancels encoded keydowns at its textarea, so document-bubble
    // hotkeys cannot own these chords while terminal input has focus.
    window.addEventListener('keydown', captureTerminalFocusedGlobalShortcut, true)
    return () => window.removeEventListener('keydown', captureTerminalFocusedGlobalShortcut, true)
  }, [options.shortcutBindings, options.toggleSidebar, options.toggleTerminal])

  return (action: () => void, scope: ShortcutScope, event: KeyboardEvent) => {
    const targetsTerminal = eventTargetsTerminal(event)
    if (scope === 'application' && targetsTerminal) return
    if (targetsTerminal && event.code.length > 0) {
      suppressedTerminalKeyUpsRef.current.add(event.code)
    }
    event.preventDefault()
    event.stopPropagation()
    action()
  }
}
