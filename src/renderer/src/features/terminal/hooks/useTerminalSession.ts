import { FitAddon } from '@xterm/addon-fit'
import { type ITheme, Terminal } from '@xterm/xterm'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'

const TERMINAL_SELECTION_OPACITY = 0.3
const DEFAULT_TERMINAL_FONT_SIZE = 14

function colorWithOpacity(color: string, opacity: number) {
  const context = document.createElement('canvas').getContext('2d')
  if (context === null) return color

  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

function terminalAppearance() {
  const styles = getComputedStyle(document.documentElement)
  const color = (name: string) => styles.getPropertyValue(name).trim()
  const accent = color('--color-accent')
  const theme: ITheme = {
    background: color('--color-bg'),
    foreground: color('--color-text-primary'),
    cursor: accent,
    selectionBackground: colorWithOpacity(accent, TERMINAL_SELECTION_OPACITY),
    black: color('--color-diff-bg'),
    red: color('--color-error'),
    green: color('--color-success'),
    yellow: accent,
    blue: color('--color-info'),
    magenta: color('--color-review'),
    cyan: color('--color-progress'),
    white: color('--color-text-secondary'),
    brightBlack: color('--color-text-muted'),
    brightRed: color('--color-error-text'),
    brightGreen: color('--color-success'),
    brightYellow: accent,
    brightBlue: color('--color-info-text'),
    brightMagenta: color('--color-plan'),
    brightCyan: color('--color-progress'),
    brightWhite: color('--color-text-primary'),
  }

  const fontSize = Number.parseFloat(styles.getPropertyValue('--font-terminal-size'))
  return {
    fontFamily: styles.getPropertyValue('--font-terminal').trim(),
    fontSize: Number.isFinite(fontSize) ? fontSize : DEFAULT_TERMINAL_FONT_SIZE,
    theme,
  }
}

function createTerminal() {
  const appearance = terminalAppearance()
  return new Terminal({
    theme: appearance.theme,
    fontSize: appearance.fontSize,
    fontFamily: appearance.fontFamily,
    cursorBlink: true,
    allowProposedApi: true,
  })
}

function setTerminalReady(
  terminalIdRef: RefObject<string | null>,
  id: string,
  term: Terminal,
  setTerminalStatus: (status: {
    readonly isReady: boolean
    readonly errorMessage: string | null
  }) => void,
) {
  terminalIdRef.current = id
  setTerminalStatus({ isReady: true, errorMessage: null })
  api.resizeTerminal(id, term.cols, term.rows)
}

function setTerminalError(
  error: unknown,
  setTerminalStatus: (status: {
    readonly isReady: boolean
    readonly errorMessage: string | null
  }) => void,
) {
  setTerminalStatus({
    isReady: false,
    errorMessage: error instanceof Error ? error.message : 'Failed to open terminal.',
  })
}

export function useTerminalSession(projectPath: string | null) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalIdRef = useRef<string | null>(null)
  const [terminalStatus, setTerminalStatus] = useState<{
    readonly isReady: boolean
    readonly errorMessage: string | null
  }>({
    isReady: false,
    errorMessage: null,
  })

  useEffect(() => {
    if (!containerRef.current) return
    let cleanedUp = false

    const term = createTerminal()
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    let geometryFrame: number | null = null
    const synchronizeGeometry = () => {
      if (geometryFrame !== null) cancelAnimationFrame(geometryFrame)
      geometryFrame = requestAnimationFrame(() => {
        geometryFrame = null
        if (cleanedUp) return
        fitAddon.fit()
        if (terminalIdRef.current) {
          api.resizeTerminal(terminalIdRef.current, term.cols, term.rows)
        }
      })
    }
    synchronizeGeometry()
    const appearanceObserver = new MutationObserver(() => {
      const appearance = terminalAppearance()
      term.options.theme = appearance.theme
      term.options.fontFamily = appearance.fontFamily
      term.options.fontSize = appearance.fontSize
      synchronizeGeometry()
    })
    const fitLoadedFont = () => synchronizeGeometry()
    appearanceObserver.observe(document.documentElement, {
      attributeFilter: ['data-theme', 'style'],
      attributes: true,
    })
    document.fonts.addEventListener('loadingdone', fitLoadedFont)

    const cwd = projectPath ?? ''
    // This effect owns the terminal it creates. Tracking the id in an
    // effect-scoped local (instead of reading terminalIdRef.current at cleanup)
    // keeps ownership unambiguous AND fixes a leak: if cleanup ran before
    // createTerminal resolved, the ref was still null and the terminal was never
    // closed (react-doctor/exhaustive-deps).
    let createdTerminalId: string | null = null
    api
      .createTerminal(cwd)
      .then((id) => {
        createdTerminalId = id
        if (cleanedUp) {
          void api.closeTerminal(id)
          return
        }
        setTerminalReady(terminalIdRef, id, term, setTerminalStatus)
      })
      .catch((error: unknown) => {
        if (!cleanedUp) setTerminalError(error, setTerminalStatus)
      })

    const inputDispose = term.onData((data) => {
      if (terminalIdRef.current) api.writeTerminal(terminalIdRef.current, data)
    })
    const unsubscribe = api.onTerminalData((payload) => {
      if (payload.terminalId === terminalIdRef.current) term.write(payload.data)
    })
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      if (terminalIdRef.current) {
        api.resizeTerminal(terminalIdRef.current, term.cols, term.rows)
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      cleanedUp = true
      if (geometryFrame !== null) cancelAnimationFrame(geometryFrame)
      inputDispose.dispose()
      unsubscribe()
      appearanceObserver.disconnect()
      document.fonts.removeEventListener('loadingdone', fitLoadedFont)
      resizeObserver.disconnect()
      if (createdTerminalId) void api.closeTerminal(createdTerminalId)
      term.dispose()
    }
  }, [projectPath])

  return { containerRef, terminalStatus }
}
