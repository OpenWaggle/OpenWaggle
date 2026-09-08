import type { Terminal } from '@xterm/xterm'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { TerminalContextRange } from './terminal-context'
import type { TerminalLaunchEnvironment } from './terminal-launch-environment'

export interface TerminalRestartOptions {
  readonly cwd?: string
  readonly launchEnv?: TerminalLaunchEnvironment
}

interface TerminalPaneActionOptions {
  readonly terminalRef: RefObject<Terminal | null>
  readonly restartRef: RefObject<((next?: TerminalRestartOptions) => Promise<void>) | null>
  readonly sendInputNowRef: RefObject<(() => Promise<void>) | null>
  readonly pasteRef: RefObject<(() => Promise<void>) | null>
  readonly setInputError: Dispatch<SetStateAction<string | null>>
  readonly setSelectionText: Dispatch<SetStateAction<string>>
}

export interface ContextMenuModifiers {
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

function selectionRange(terminal: Terminal | null): TerminalContextRange | null {
  const position = terminal?.getSelectionPosition()
  if (position === undefined) return null
  const startLine = position.start.y + 1
  return { startLine, endLine: Math.max(startLine, position.end.y + 1) }
}

function selectionEndClientRect(terminal: Terminal | null) {
  const position = terminal?.getSelectionPosition()
  const element = terminal?.element
  const dimensions = terminal?.dimensions
  if (
    terminal === null ||
    position === undefined ||
    element === undefined ||
    dimensions === undefined
  ) {
    return null
  }
  const screen = element.querySelector<HTMLElement>('.xterm-screen') ?? element
  const bounds = screen.getBoundingClientRect()
  const viewportRow = position.end.y - terminal.buffer.active.viewportY
  if (viewportRow < 0 || viewportRow >= terminal.rows) return null
  return {
    right: bounds.left + position.end.x * dimensions.css.cell.width,
    bottom: bounds.top + (viewportRow + 1) * dimensions.css.cell.height,
  }
}

export function createTerminalPaneActions(options: TerminalPaneActionOptions) {
  const focus = () => options.terminalRef.current?.focus()
  const restart = async (next?: TerminalRestartOptions) => options.restartRef.current?.(next)
  const sendInputNow = () => {
    void options.sendInputNowRef.current?.().catch((error: unknown) => {
      options.setInputError(
        error instanceof Error ? error.message : 'Terminal input could not be sent.',
      )
    })
  }
  const clearSelection = () => {
    options.terminalRef.current?.clearSelection()
    options.setSelectionText('')
    options.terminalRef.current?.focus()
  }
  return {
    focus,
    restart,
    sendInputNow,
    getSelection: () => options.terminalRef.current?.getSelection() ?? '',
    getSelectionRange: () => selectionRange(options.terminalRef.current),
    getSelectionEndClientRect: () => selectionEndClientRect(options.terminalRef.current),
    shouldOpenContextMenu: (modifiers: ContextMenuModifiers) => {
      const terminal = options.terminalRef.current
      if (terminal === null || terminal.modes.mouseTrackingMode === 'none') return true
      return modifiers.shiftKey || modifiers.ctrlKey || modifiers.metaKey
    },
    clearSelection,
    paste: async () => options.pasteRef.current?.(),
  }
}
