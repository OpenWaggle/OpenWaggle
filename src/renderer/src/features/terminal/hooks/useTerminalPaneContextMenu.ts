import { type MouseEvent, useState } from 'react'
import type { TerminalContextRange } from '../lib/terminal-context'

export interface TerminalPaneContextMenuState {
  readonly position: { readonly x: number; readonly y: number }
  readonly selectedText: string
  readonly range: TerminalContextRange | null
}

interface TerminalPaneContextMenuOptions {
  readonly focusPane: () => void
  readonly focusTerminal: () => void
  readonly getSelection: () => string
  readonly getSelectionRange: () => TerminalContextRange | null
  readonly shouldOpen: (event: MouseEvent<HTMLElement>) => boolean
}

export function useTerminalPaneContextMenu(options: TerminalPaneContextMenuOptions) {
  const [contextMenu, setContextMenu] = useState<TerminalPaneContextMenuState | null>(null)
  const openContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    if (!options.shouldOpen(event)) return
    options.focusPane()
    options.focusTerminal()
    setContextMenu({
      position: { x: event.clientX, y: event.clientY },
      selectedText: options.getSelection(),
      range: options.getSelectionRange(),
    })
  }
  return {
    contextMenu,
    openContextMenu,
    closeContextMenu: () => setContextMenu(null),
  }
}
