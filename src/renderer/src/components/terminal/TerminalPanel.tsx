import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/ipc'
import '@xterm/xterm/css/xterm.css'

const FONT_SIZE = 14

interface TerminalPanelProps {
  projectPath: string | null
  onClose: () => void
}

export function TerminalPanel({ projectPath, onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
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

    const term = new Terminal({
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#f59e0b',
        selectionBackground: 'rgba(245, 158, 11, 0.3)',
        black: '#0a0a0a',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      fontSize: FONT_SIZE,
      fontFamily: '"SF Mono", "Fira Code", "JetBrains Mono", monospace',
      cursorBlink: true,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Fit after a brief delay to ensure container is measured
    requestAnimationFrame(() => {
      fitAddon.fit()
    })

    // Create PTY
    const cwd = projectPath ?? ''
    api
      .createTerminal(cwd)
      .then((id) => {
        if (cleanedUp) return
        terminalIdRef.current = id
        setTerminalStatus({
          isReady: true,
          errorMessage: null,
        })

        // Send dimensions
        api.resizeTerminal(id, term.cols, term.rows)
      })
      .catch((error: unknown) => {
        if (cleanedUp) return
        setTerminalStatus({
          isReady: false,
          errorMessage: error instanceof Error ? error.message : 'Failed to open terminal.',
        })
      })

    // Forward keyboard input to PTY
    const inputDispose = term.onData((data) => {
      if (terminalIdRef.current) {
        api.writeTerminal(terminalIdRef.current, data)
      }
    })

    // Receive PTY output
    const unsubscribe = api.onTerminalData((payload) => {
      if (payload.terminalId === terminalIdRef.current) {
        term.write(payload.data)
      }
    })

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      if (terminalIdRef.current) {
        api.resizeTerminal(terminalIdRef.current, term.cols, term.rows)
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      cleanedUp = true
      inputDispose.dispose()
      unsubscribe()
      resizeObserver.disconnect()
      if (terminalIdRef.current) {
        api.closeTerminal(terminalIdRef.current)
      }
      term.dispose()
    }
  }, [projectPath])

  return (
    <div className="flex shrink-0 flex-col border-t border-border bg-bg h-full">
      {/* Terminal header */}
      <div className="flex h-8 items-center justify-between border-b border-border px-3">
        <span className="text-[13px] text-text-secondary">
          Terminal{' '}
          {terminalStatus.errorMessage
            ? 'unavailable'
            : terminalStatus.isReady
              ? '/bin/zsh'
              : 'connecting...'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center rounded p-0.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title="Close terminal"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Terminal container */}
      <div ref={containerRef} className="flex-1 overflow-hidden px-1 py-1" />
      {terminalStatus.errorMessage && (
        <div className="border-t border-border px-3 py-2 text-[12px] text-error">
          {terminalStatus.errorMessage}
        </div>
      )}
    </div>
  )
}
