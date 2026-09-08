import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalAttachResult, TerminalReadinessSnapshot } from '@shared/types/terminal'
import type { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createTerminalViewport } from '../lib/create-terminal-viewport'
import { observeTerminalAppearance } from '../lib/terminal-appearance'
import { createTerminalAttachSnapshotApplier } from '../lib/terminal-attach-snapshot'
import { createTerminalClipboardController } from '../lib/terminal-clipboard-controller'
import { createTerminalCustomKeyHandler } from '../lib/terminal-custom-key-handler'
import { terminalEventMatchesOwner } from '../lib/terminal-event-owner-alias'
import { ensureTerminalSymbolsFont } from '../lib/terminal-fonts'
import { createTerminalGeometryController } from '../lib/terminal-geometry-controller'
import { terminalInputDispatcher } from '../lib/terminal-input-dispatcher'
import { createTerminalOutputDelivery } from '../lib/terminal-output-delivery'
import {
  createTerminalPaneActions,
  type TerminalRestartOptions,
} from '../lib/terminal-pane-actions'
import { acquireTerminalSurfaceLease } from '../lib/terminal-surface-lease'
import { resetTerminalOutput } from '../lib/write-terminal-output'
import { useTerminalStore } from '../state/terminal-store'
import type { TerminalPaneSessionOptions } from './terminal-pane-session-model'

const INITIAL_DIMS = { cols: TERMINAL.DEFAULT_COLS, rows: TERMINAL.DEFAULT_ROWS }

export function useTerminalPaneSession(options: TerminalPaneSessionOptions) {
  const {
    ownerKey,
    terminalId,
    cwd,
    launchEnv,
    projectRoot,
    containerRef,
    onSearchAddon,
    onActivateLink,
  } = options
  const termRef = useRef<Terminal | null>(null)
  const dimsRef = useRef<{ cols: number; rows: number }>(INITIAL_DIMS)
  const attachedRef = useRef(false)
  const restartRef = useRef<((next?: TerminalRestartOptions) => Promise<void>) | null>(null)
  const sendInputNowRef = useRef<(() => Promise<void>) | null>(null)
  const pasteRef = useRef<(() => Promise<void>) | null>(null)
  const onSearchAddonRef = useRef(onSearchAddon)
  const onActivateLinkRef = useRef(onActivateLink)
  const [status, setStatus] = useState<'ready' | 'cwd-missing' | 'error' | 'stopped'>('ready')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [readiness, setReadiness] = useState<TerminalReadinessSnapshot | null>(null)
  const [inputWaiting, setInputWaiting] = useState(false)
  const [inputError, setInputError] = useState<string | null>(null)
  const [selectionText, setSelectionText] = useState('')
  useEffect(() => {
    onSearchAddonRef.current = onSearchAddon
    onActivateLinkRef.current = onActivateLink
  })

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    let cleanedUp = false
    let openStarted = false
    const releaseSurfaceLease = acquireTerminalSurfaceLease(ownerKey, terminalId)
    const inputClient = terminalInputDispatcher.acquire(ownerKey, terminalId)
    const unsubscribeInputStatus = inputClient.subscribe((snapshot) => {
      if (cleanedUp) return
      setInputWaiting(snapshot.waiting)
      setInputError(snapshot.error)
    })

    // Start loading the bundled symbol-only face before xterm resolves its font
    // stack. Text still comes from the user's selected terminal font; the face
    // only fills private-use prompt glyphs and a loading completion refits once.
    void ensureTerminalSymbolsFont()
    const { term, fitAddon, searchAddon, linkProvider } = createTerminalViewport({
      container,
      cwd,
      projectRoot,
      platform: navigator.userAgent,
      onActivateLink: (target) => onActivateLinkRef.current(target),
    })
    const outputDelivery = createTerminalOutputDelivery({
      ownerKey,
      terminalId,
      terminal: term,
      acknowledge: api.acknowledgeTerminalOutput,
    })
    termRef.current = term

    const clipboard = createTerminalClipboardController({
      terminal: term,
      platform: navigator.userAgent,
      readText: api.readFromClipboard,
      writeText: api.copyToClipboard,
      enqueuePaste: inputClient.enqueueAsync,
      onError: (error) => {
        if (!cleanedUp) {
          setInputError(error instanceof Error ? error.message : 'Clipboard could not be pasted.')
        }
      },
    })
    pasteRef.current = clipboard.paste

    const applySnapshot = createTerminalAttachSnapshotApplier({
      ownerKey,
      terminalId,
      outputDelivery,
      setReadiness,
    })

    const startOpen = () => {
      if (openStarted || cleanedUp) return
      openStarted = true
      const opening = api.openTerminal({
        ownerKey,
        terminalId,
        cwd,
        cols: term.cols,
        rows: term.rows,
        ...(launchEnv ? { env: launchEnv } : {}),
        inputGeneration: inputClient.generation,
      })
      inputClient.markOpening()
      void opening
        .then((snapshot: TerminalAttachResult) => {
          if (cleanedUp) return
          applySnapshot(snapshot)
          if (snapshot.cwdMissing === true) {
            inputClient.markUnavailable()
            setStatus('cwd-missing')
            return
          }
          attachedRef.current = true
          geometry.synchronize()
          if (snapshot.running) {
            inputClient.markOpen(snapshot.readiness, snapshot.pendingInputBytes)
          } else inputClient.markUnavailable()
          if (!snapshot.running) {
            useTerminalStore.getState().applyRuntimeEvent(ownerKey, terminalId, {
              type: 'exited',
              exitCode: snapshot.exitCode ?? 0,
            })
          }
        })
        .catch((error: unknown) => {
          if (cleanedUp) return
          inputClient.markUnavailable()
          setErrorMessage(error instanceof Error ? error.message : 'Failed to open terminal.')
          setStatus('error')
        })
    }

    const geometry = createTerminalGeometryController({
      container,
      fit: () => {
        fitAddon.fit()
        dimsRef.current = { cols: term.cols, rows: term.rows }
      },
      isAttached: () => attachedRef.current,
      isDisposed: () => cleanedUp,
      isOpenStarted: () => openStarted,
      open: startOpen,
      resize: () => {
        void api.resizeTerminal(ownerKey, terminalId, term.cols, term.rows)
      },
      resizeDebounceMs: TERMINAL.RESIZE_DEBOUNCE_MS,
    })
    geometry.synchronize()
    const disposeAppearance = observeTerminalAppearance(term, geometry.synchronize)

    term.onData((data) => {
      inputClient.enqueue(data)
    })
    term.attachCustomKeyEventHandler(
      createTerminalCustomKeyHandler({
        enqueueInput: inputClient.enqueue,
        handleClipboardKey: clipboard.handleKey,
        platform: navigator.userAgent,
      }),
    )
    term.onSelectionChange(() => {
      setSelectionText(term.getSelection())
    })

    const unsubscribe = api.onTerminalEvent((payload) => {
      if (
        !terminalEventMatchesOwner(ownerKey, payload.ownerKey) ||
        payload.terminalId !== terminalId
      ) {
        return
      }
      const { event } = payload
      if (event.type === 'output') {
        outputDelivery.write(event)
        return
      }
      if (event.type === 'cleared') {
        outputDelivery.clear(event.outputGeneration)
        resetTerminalOutput(term)
        setSelectionText('')
        return
      }
      if (event.type === 'readiness') {
        setReadiness(event.readiness)
        if (event.readiness.phase === 'ready') {
          inputClient.markReady(event.readiness)
        }
        return
      }
      if (event.type === 'closed') {
        // Main can stop a shell while this pane intentionally remains mounted
        // (for example during worktree removal). Keep the ordered input client
        // reusable so Restart can attach the replacement shell.
        attachedRef.current = false
        setReadiness(null)
        setStatus('stopped')
        inputClient.markUnavailable()
      }
      if (event.type === 'exited') inputClient.markUnavailable()
      useTerminalStore.getState().applyRuntimeEvent(ownerKey, terminalId, event)
    })

    restartRef.current = async (next = {}) => {
      const nextCwd = next.cwd ?? cwd
      const nextLaunchEnv = next.launchEnv ?? launchEnv
      const wasAttached = attachedRef.current
      attachedRef.current = false
      const rollbackOutput = outputDelivery.reset()
      let snapshot: TerminalAttachResult
      try {
        snapshot = await api.restartTerminal({
          ownerKey,
          terminalId,
          cwd: nextCwd,
          cols: dimsRef.current.cols,
          rows: dimsRef.current.rows,
          ...(nextLaunchEnv ? { env: nextLaunchEnv } : {}),
          inputGeneration: inputClient.generation,
        })
      } catch (error) {
        if (cleanedUp) throw error
        attachedRef.current = wasAttached
        if (wasAttached) geometry.synchronize()
        rollbackOutput()
        throw error
      }
      if (cleanedUp) return
      resetTerminalOutput(term)
      setSelectionText('')
      applySnapshot(snapshot)
      if (snapshot.cwdMissing === true) {
        inputClient.markUnavailable()
        setStatus('cwd-missing')
        return
      }
      if (!snapshot.running) {
        inputClient.markUnavailable()
        return
      }
      useTerminalStore.getState().clearExit(ownerKey, terminalId)
      setStatus('ready')
      attachedRef.current = true
      geometry.synchronize()
      inputClient.markOpen(snapshot.readiness, snapshot.pendingInputBytes)
      term.focus()
    }

    sendInputNowRef.current = async () => {
      const result = await api.sendTerminalInputNow(ownerKey, terminalId)
      if (cleanedUp) return
      inputClient.applyReleaseResult(result)
    }

    onSearchAddonRef.current(searchAddon)

    return () => {
      cleanedUp = true
      attachedRef.current = false
      outputDelivery.acknowledgePending()
      restartRef.current = null
      sendInputNowRef.current = null
      pasteRef.current = null
      geometry.dispose()
      disposeAppearance()
      linkProvider.dispose()
      unsubscribe()
      unsubscribeInputStatus()
      inputClient.release()
      onSearchAddonRef.current(null)
      termRef.current = null
      // Deferred detach keeps events alive across drawer/side-panel moves; it never closes.
      releaseSurfaceLease()
      term.dispose()
    }
  }, [ownerKey, terminalId, cwd, launchEnv, projectRoot, containerRef])

  const actions = createTerminalPaneActions({
    terminalRef: termRef,
    restartRef,
    sendInputNowRef,
    pasteRef,
    setInputError,
    setSelectionText,
  })

  return {
    status,
    errorMessage,
    readiness,
    inputWaiting,
    inputError,
    ...actions,
    selectionText,
  }
}
