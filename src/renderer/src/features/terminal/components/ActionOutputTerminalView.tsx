import type { ActionRun } from '@shared/types/action-runs'
import type { SearchAddon } from '@xterm/addon-search'
import { Lock } from 'lucide-react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { useTerminalLinkActivation } from '../hooks/useTerminalPaneUiActions'
import { createActionOutputFeed } from '../lib/action-output-feed'
import {
  type ActionOutputView,
  actionOutputViewTitle,
  actionRunOutcomeLabel,
} from '../lib/action-output-view-model'
import { createTerminalViewport } from '../lib/create-terminal-viewport'
import { observeTerminalAppearance } from '../lib/terminal-appearance'
import { ensureTerminalSymbolsFont } from '../lib/terminal-fonts'
import { terminalClipboardShortcutAction } from '../lib/terminal-native-keybindings'
import { writeTerminalOutput } from '../lib/write-terminal-output'

const HIDE_CURSOR = '\x1b[?25l'

interface ActionOutputTerminalViewProps {
  readonly view: ActionOutputView
  /** Working path used to resolve relative file links in the output. */
  readonly cwd: string
  readonly onSearchAddon: (addon: SearchAddon | null) => void
}

async function fetchOutputPage(
  owner: Pick<ActionOutputView, 'projectPath' | 'ownerKey'>,
  runId: string,
  afterOffset: number,
) {
  const result = await api.manageProjectActions({
    scope: { projectPath: owner.projectPath, sessionId: owner.ownerKey },
    operation: { type: 'output', runId, afterOffset },
  })
  if (result.type !== 'output') throw new Error('Unexpected action output response.')
  return result.output
}

function useActionOutputTerminal(
  props: ActionOutputTerminalViewProps,
  containerRef: RefObject<HTMLDivElement | null>,
) {
  const { view, cwd, onSearchAddon } = props
  const { ownerKey, projectPath } = view
  const [run, setRun] = useState<ActionRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const feedRef = useRef<ReturnType<typeof createActionOutputFeed> | null>(null)
  const runIdsRef = useRef(view.runIds)
  const onSearchAddonRef = useRef(onSearchAddon)
  const activateLink = useTerminalLinkActivation(ownerKey)
  const activateLinkRef = useRef(activateLink)
  useEffect(() => {
    onSearchAddonRef.current = onSearchAddon
    activateLinkRef.current = activateLink
    runIdsRef.current = view.runIds
  })

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    void ensureTerminalSymbolsFont()
    const { term, fitAddon, searchAddon, linkProvider } = createTerminalViewport({
      container,
      cwd,
      projectRoot: cwd,
      platform: navigator.userAgent,
      onActivateLink: (target) => activateLinkRef.current(target),
    })
    // Read-only: no PTY and no input. xterm's own query replies go nowhere.
    term.options.disableStdin = true
    term.options.cursorBlink = false
    // A run's clear-screen scrolls earlier output up rather than erasing it.
    term.options.scrollOnEraseInDisplay = true
    term.write(HIDE_CURSOR)
    term.attachCustomKeyEventHandler((event) => {
      const action = terminalClipboardShortcutAction(event, navigator.userAgent)
      if (action === null) return true
      event.preventDefault()
      const selection = term.getSelection()
      if (action === 'copy' && selection.length > 0) api.copyToClipboard(selection)
      return false
    })
    const refit = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) fitAddon.fit()
    }
    const resizeObserver =
      typeof ResizeObserver === 'function' ? new ResizeObserver(() => refit()) : null
    resizeObserver?.observe(container)
    const disposeAppearance = observeTerminalAppearance(term, refit)
    const feed = createActionOutputFeed({
      fetchPage: (runId, afterOffset) =>
        fetchOutputPage({ ownerKey, projectPath }, runId, afterOffset),
      write: (text) => writeTerminalOutput(term, text),
      onRun: setRun,
      onError: setError,
    })
    feedRef.current = feed
    feed.setRuns(runIdsRef.current)
    onSearchAddonRef.current(searchAddon)
    return () => {
      feedRef.current = null
      feed.dispose()
      resizeObserver?.disconnect()
      disposeAppearance()
      linkProvider.dispose()
      onSearchAddonRef.current(null)
      term.dispose()
    }
  }, [ownerKey, projectPath, cwd, containerRef])

  useEffect(() => {
    feedRef.current?.setRuns(view.runIds)
  }, [view.runIds])

  return { run, error }
}

/**
 * A read-only Terminal tab showing one Project action's live and retained output through the
 * same xterm rendering as terminals. Stop and Restart stay in Project Actions.
 */
export function ActionOutputTerminalView(props: ActionOutputTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { run, error } = useActionOutputTerminal(props, containerRef)
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={actionOutputViewTitle(props.view)}
      data-action-output-view={props.view.actionId}
    >
      <div className="flex h-6 shrink-0 items-center gap-2 border-b border-border px-2 text-xs text-text-tertiary">
        <Lock className="size-3" aria-hidden />
        <span>Read-only</span>
        <span aria-live="polite" className="text-text-secondary">
          {run ? actionRunOutcomeLabel(run) : 'Connecting…'}
        </span>
        {error ? (
          <span role="status" className="min-w-0 truncate" title={error}>
            Reconnecting… {error}
          </span>
        ) : null}
        <span className="ml-auto hidden truncate sm:inline">
          Stop and Restart are in Project Actions
        </span>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 px-2 py-1" />
    </section>
  )
}
