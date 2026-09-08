import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal } from '@xterm/xterm'
import { readTerminalAppearance } from './terminal-appearance'
import type { TerminalLinkActivationTarget } from './terminal-links'
import { createTerminalLinkProvider, createTerminalOsc8LinkHandler } from './terminal-xterm-links'

const RENDER_SCROLLBACK_LINES = 10_000

interface TerminalViewportOptions {
  readonly container: HTMLElement
  readonly cwd: string
  readonly projectRoot: string
  readonly platform: string
  readonly onActivateLink: (target: TerminalLinkActivationTarget) => void
}

export function createTerminalViewport(options: TerminalViewportOptions) {
  const appearance = readTerminalAppearance()
  const linkContext = { cwd: options.cwd, projectRoot: options.projectRoot }
  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const term = new Terminal({
    theme: appearance.theme,
    fontFamily: appearance.fontFamily,
    fontSize: appearance.fontSize,
    cursorBlink: !reduceMotion,
    allowProposedApi: true,
    // Modern TUIs can negotiate Kitty press/repeat/release; legacy encoding stays the default.
    vtExtensions: { kittyKeyboard: true },
    linkHandler: createTerminalOsc8LinkHandler(
      linkContext,
      options.platform,
      options.onActivateLink,
    ),
    scrollback: RENDER_SCROLLBACK_LINES,
  })
  const fitAddon = new FitAddon()
  const searchAddon = new SearchAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(searchAddon)
  term.open(options.container)
  const linkProvider = term.registerLinkProvider(
    createTerminalLinkProvider({
      buffer: term.buffer,
      context: linkContext,
      platform: options.platform,
      onActivate: options.onActivateLink,
    }),
  )
  return { term, fitAddon, searchAddon, linkProvider }
}
