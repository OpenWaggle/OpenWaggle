import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalAttachResult, TerminalRuntimeEvent } from '@shared/types/terminal'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { observeTerminalAppearance, readTerminalAppearance } from '../lib/terminal-appearance'
import { useTerminalStore } from '../state/terminal-store'

export type TerminalPaneStatus = 'ready' | 'cwd-missing' | 'error'

interface TerminalPaneSessionOptions {
  readonly ownerKey: string
  readonly terminalId: string
  readonly cwd: string
  readonly containerRef: React.RefObject<HTMLDivElement | null>
  readonly onSearchAddon: (addon: SearchAddon | null) => void
}

const RESIZE_DEBOUNCE_MS = TERMINAL.RESIZE_DEBOUNCE_MS
const RENDER_SCROLLBACK_LINES = 10_000
const INITIAL_DIMS: { cols: number; rows: number } = {
  cols: TERMINAL.DEFAULT_COLS,
  rows: TERMINAL.DEFAULT_ROWS,
}

interface BufferedOutput {
  readonly data: string
  readonly startOffset: number
  readonly endOffset: number
}

/**
 * Owns one pane's xterm session: creates the terminal (WebGL renderer with
 * graceful DOM fallback), attaches to the main process with scrollback replay,
 * streams coalesced output through snapshot-offset gating, and resizes through
 * a debounced PTY RPC. Detaching never kills the shell — terminals survive
 * invisibility (ADR 0030).
 */
export function useTerminalPaneSession(options: TerminalPaneSessionOptions) {
  const { ownerKey, terminalId, cwd, containerRef, onSearchAddon } = options
  const termRef = useRef<Terminal | null>(null)
  const dimsRef = useRef(INITIAL_DIMS)
  const attachedRef = useRef(false)
  const onSearchAddonRef = useRef(onSearchAddon)
  const [status, setStatus] = useState<TerminalPaneStatus>('ready')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  /** Attach/restart snapshots gate live output; reset to 0 on clear/restart. */
  const snapshotOutputBytesRef = useRef<number | null>(null)

  useEffect(() => {
    onSearchAddonRef.current = onSearchAddon
  })

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    let cleanedUp = false
    let resizeTimer: number | null = null
    let geometryFrame: number | null = null

    // Output events that arrive while the open round-trip is in flight may be
    // covered by the attach snapshot: the main process appends to scrollback
    // before flushing the corresponding event. Buffer them, then drop the
    // snapshot-covered span on delivery using exact stream offsets.
    const bufferedOutput: BufferedOutput[] = []

    const writeGated = (event: Extract<TerminalRuntimeEvent, { type: 'output' }>) => {
      const snapshotOutputBytes = snapshotOutputBytesRef.current
      if (snapshotOutputBytes === null) {
        bufferedOutput.push({
          data: event.data,
          startOffset: event.startOffset,
          endOffset: event.endOffset,
        })
        return
      }
      const skip = Math.min(Math.max(snapshotOutputBytes - event.startOffset, 0), event.data.length)
      if (skip < event.data.length) term.write(event.data.slice(skip))
    }

    const appearance = readTerminalAppearance()
    const term = new Terminal({
      theme: appearance.theme,
      fontFamily: appearance.fontFamily,
      fontSize: appearance.fontSize,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: RENDER_SCROLLBACK_LINES,
    })
    termRef.current = term
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.loadAddon(new WebLinksAddon((_event, uri) => void api.openExternal(uri)))
    // The DOM renderer only: xterm's WebGL addon mis-scales glyphs inside this
    // panel (DPR/viewport mismatch — content renders tiny in the corner), which
    // is the exact class of surface bug t3code solved with a custom renderer.
    // The DOM renderer is deterministic and fast enough behind coalesced IPC.
    term.open(container)

    const fitToGrid = () => {
      fitAddon.fit()
      dimsRef.current = { cols: term.cols, rows: term.rows }
    }

    const requestResize = () => {
      fitToGrid()
      if (resizeTimer !== null) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null
        if (!cleanedUp && attachedRef.current) {
          void api.resizeTerminal(ownerKey, terminalId, term.cols, term.rows)
        }
      }, RESIZE_DEBOUNCE_MS)
    }

    const synchronizeGeometry = () => {
      if (geometryFrame !== null) cancelAnimationFrame(geometryFrame)
      geometryFrame = requestAnimationFrame(() => {
        geometryFrame = null
        if (!cleanedUp) requestResize()
      })
    }

    synchronizeGeometry()
    const disposeAppearance = observeTerminalAppearance(term, synchronizeGeometry)

    term.onData((data) => {
      if (attachedRef.current) api.writeTerminal(ownerKey, terminalId, data)
    })

    const unsubscribe = api.onTerminalEvent((payload) => {
      if (payload.ownerKey !== ownerKey || payload.terminalId !== terminalId) return
      const { event } = payload
      if (event.type === 'output') {
        writeGated(event)
        return
      }
      if (event.type === 'cleared') {
        snapshotOutputBytesRef.current = 0
        bufferedOutput.length = 0
        term.reset()
        return
      }
      useTerminalStore.getState().applyRuntimeEvent(ownerKey, terminalId, event)
    })

    attachedRef.current = true
    void api
      .openTerminal({ ownerKey, terminalId, cwd, cols: term.cols, rows: term.rows })
      .then((snapshot: TerminalAttachResult) => {
        if (cleanedUp) return
        snapshotOutputBytesRef.current = snapshot.outputBytes
        if (snapshot.history.length > 0) term.write(snapshot.history)
        for (const buffered of bufferedOutput) {
          const skip = Math.min(
            Math.max(snapshot.outputBytes - buffered.startOffset, 0),
            buffered.data.length,
          )
          if (skip < buffered.data.length) term.write(buffered.data.slice(skip))
        }
        bufferedOutput.length = 0
        if (snapshot.cwdMissing === true) {
          attachedRef.current = false
          setStatus('cwd-missing')
          return
        }
        if (!snapshot.running) {
          useTerminalStore.getState().applyRuntimeEvent(ownerKey, terminalId, {
            type: 'exited',
            exitCode: snapshot.exitCode ?? 0,
          })
        }
        // The PTY was created at open-time dims; align it to the fitted grid.
        void api.resizeTerminal(ownerKey, terminalId, term.cols, term.rows)
      })
      .catch((error: unknown) => {
        if (cleanedUp) return
        attachedRef.current = false
        setErrorMessage(error instanceof Error ? error.message : 'Failed to open terminal.')
        setStatus('error')
      })

    const resizeObserver = new ResizeObserver(() => synchronizeGeometry())
    resizeObserver.observe(container)
    onSearchAddonRef.current(searchAddon)

    return () => {
      cleanedUp = true
      attachedRef.current = false
      if (geometryFrame !== null) cancelAnimationFrame(geometryFrame)
      if (resizeTimer !== null) window.clearTimeout(resizeTimer)
      disposeAppearance()
      unsubscribe()
      resizeObserver.disconnect()
      onSearchAddonRef.current(null)
      termRef.current = null
      // Detach, never close: the shell keeps running hidden and replays its
      // scrollback when this pane is viewed again (ADR 0030).
      void api.detachTerminal(ownerKey, terminalId)
      term.dispose()
    }
  }, [ownerKey, terminalId, cwd, containerRef])

  /** Focus this pane's xterm — called on interaction, not just prop changes. */
  const focus = () => {
    termRef.current?.focus()
  }

  const restart = () => {
    void api
      .restartTerminal({
        ownerKey,
        terminalId,
        cwd,
        cols: dimsRef.current.cols,
        rows: dimsRef.current.rows,
      })
      .then((snapshot) => {
        if (snapshot.running) {
          // The restarted shell starts a fresh output stream at offset 0.
          snapshotOutputBytesRef.current = snapshot.outputBytes
          useTerminalStore.getState().clearExit(ownerKey, terminalId)
          setStatus('ready')
          termRef.current?.reset()
          termRef.current?.focus()
        }
      })
      .catch(() => undefined)
  }

  return { status, errorMessage, restart, focus }
}
