import { TERMINAL } from '@shared/constants/resource-limits'
import type { SearchAddon } from '@xterm/addon-search'
import { useEffect, useRef } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { useTerminalPaneSession } from '../hooks/useTerminalPaneSession'
import { runtimeKeyOf } from '../lib/terminal-owner'
import { useTerminalStore } from '../state/terminal-store'

interface TerminalPaneProps {
  readonly ownerKey: string
  readonly terminalId: string
  readonly cwd: string
  readonly focused: boolean
  readonly onFocus: () => void
  readonly onSearchAddon: (addon: SearchAddon | null) => void
}

const OVERLAY_BACKDROP =
  'absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-bg/85 text-center'

/** One split pane showing a single Session terminal's viewport. */
export function TerminalPane(props: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const onFocusRef = useRef(props.onFocus)
  const { ownerKey, terminalId, cwd } = props

  const { status, errorMessage, restart, focus } = useTerminalPaneSession({
    ownerKey,
    terminalId,
    cwd,
    containerRef,
    onSearchAddon: props.onSearchAddon,
  })
  const focusRef = useRef(focus)

  useEffect(() => {
    focusRef.current = focus
  })

  const runtimeKey = runtimeKeyOf(ownerKey, terminalId)
  const exitCode = useTerminalStore((state) => state.exits[runtimeKey])
  const ports = useTerminalStore((state) => state.portPreviews[runtimeKey])

  useEffect(() => {
    onFocusRef.current = props.onFocus
  })

  useEffect(() => {
    const pane = paneRef.current
    if (pane === null) return
    // Focus the terminal directly on interaction: state-driven focus alone
    // misses clicks when the focused prop does not change (e.g. after the
    // user clicked a header button, which steals focus from the pane).
    const handleMouseDown = () => {
      onFocusRef.current()
      focusRef.current()
    }
    pane.addEventListener('mousedown', handleMouseDown)
    return () => pane.removeEventListener('mousedown', handleMouseDown)
  }, [])

  useEffect(() => {
    if (!props.focused) return
    // Focus after mount layout; xterm needs visible geometry to show the caret.
    const frame = requestAnimationFrame(() => {
      const helper = containerRef.current?.querySelector('textarea.xterm-helper-textarea')
      if (helper instanceof HTMLTextAreaElement) helper.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [props.focused])

  return (
    <div
      ref={paneRef}
      className="relative h-full min-w-0 flex-1"
      data-terminal-pane={terminalId}
      data-focused={props.focused ? 'true' : 'false'}
    >
      <div ref={containerRef} className="absolute inset-0 px-2 py-1" />
      {status === 'cwd-missing' && (
        <div className={OVERLAY_BACKDROP}>
          <p className="text-sm font-medium text-text-primary">Working path no longer exists</p>
          <p className="max-w-full truncate px-6 text-xs text-text-muted">{cwd}</p>
        </div>
      )}
      {status === 'error' && (
        <div className={OVERLAY_BACKDROP}>
          <p className="text-sm text-error">{errorMessage ?? 'Terminal error'}</p>
        </div>
      )}
      {status === 'ready' && exitCode !== undefined && (
        <div className="absolute inset-x-2 bottom-1 z-10 flex items-center justify-between rounded border border-border bg-bg-hover px-2 py-1">
          <span className="text-xs text-text-tertiary">
            Shell exited{exitCode !== 0 ? ` (code ${exitCode})` : ''}
          </span>
          <Button size="xs" variant="secondary" onClick={restart}>
            Restart
          </Button>
        </div>
      )}
      {ports !== undefined && ports.length > 0 && (
        <div className="absolute right-2 top-1 z-10 flex gap-1">
          {ports.slice(0, TERMINAL.MAX_PORT_PREVIEWS_SHOWN).map((port) => (
            <Button
              key={port}
              size="xs"
              variant="secondary"
              title={`Open http://localhost:${port}`}
              onClick={() => void api.openExternal(`http://localhost:${port}`)}
            >
              :{port} ↗
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
