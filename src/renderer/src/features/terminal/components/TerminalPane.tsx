import { useRef } from 'react'
import { cn } from '@/shared/lib/cn'
import { useTerminalPaneContextMenu } from '../hooks/useTerminalPaneContextMenu'
import { useTerminalPaneFocus } from '../hooks/useTerminalPaneFocus'
import { useTerminalPaneSession } from '../hooks/useTerminalPaneSession'
import {
  useTerminalLinkActivation,
  useTerminalPaneUiActions,
} from '../hooks/useTerminalPaneUiActions'
import { useTerminalSelectionToolbar } from '../hooks/useTerminalSelectionToolbar'
import { rememberTerminalLayoutFocus } from '../lib/terminal-focus-location'
import { runtimeKeyOf } from '../lib/terminal-owner'
import { useTerminalStore } from '../state/terminal-store'
import {
  OriginalCheckoutBanner,
  TerminalPortPreviews,
  TerminalStatusLayers,
} from './TerminalPaneLayers'
import { TerminalPaneMenus } from './TerminalPaneMenus'
import type { TerminalPaneModel, TerminalPaneProps } from './terminal-pane-model'

function createPaneFocusHandler(pane: TerminalPaneModel, onFocus: () => void) {
  return () => {
    rememberTerminalLayoutFocus(pane.runtimeOwnerKey, pane.ownerKey)
    onFocus()
  }
}

function useTerminalRuntimeLayers(ownerKey: string, terminalId: string) {
  const runtimeKey = runtimeKeyOf(ownerKey, terminalId)
  return {
    exitCode: useTerminalStore((state) => state.exits[runtimeKey]),
    ports: useTerminalStore((state) => state.portPreviews[runtimeKey]),
  }
}

/** One split pane showing a single Session terminal's viewport. */
export function TerminalPane(props: TerminalPaneProps) {
  const { pane } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const selectionToolbarRef = useRef<HTMLDivElement>(null)
  const activateTerminalLink = useTerminalLinkActivation(pane.runtimeOwnerKey)
  const session = useTerminalPaneSession({
    ownerKey: pane.runtimeOwnerKey,
    terminalId: pane.terminalId,
    cwd: pane.cwd,
    launchEnv: pane.launchEnv,
    projectRoot: pane.defaultCwd,
    containerRef,
    onSearchAddon: props.onSearchAddon,
    onActivateLink: activateTerminalLink,
  })
  const actions = useTerminalPaneUiActions({ pane, session })
  const selectionToolbar = useTerminalSelectionToolbar({
    surfaceRef: containerRef,
    toolbarRef: selectionToolbarRef,
    selectionText: session.selectionText,
    getSelectionEndRect: session.getSelectionEndClientRect,
  })
  const focusPane = createPaneFocusHandler(pane, props.onFocus)
  useTerminalPaneFocus({
    containerRef,
    paneRef,
    focused: props.focused,
    focus: session.focus,
    onFocus: focusPane,
  })

  const { exitCode, ports } = useTerminalRuntimeLayers(pane.runtimeOwnerKey, pane.terminalId)
  const contextMenu = useTerminalPaneContextMenu({
    focusPane,
    focusTerminal: session.focus,
    getSelection: session.getSelection,
    getSelectionRange: session.getSelectionRange,
    shouldOpen: session.shouldOpenContextMenu,
  })

  return (
    <section
      ref={paneRef}
      className={cn(
        'relative h-full min-w-0 flex-1',
        props.focused && 'ring-1 ring-inset ring-accent/30',
      )}
      data-terminal-pane={pane.terminalId}
      data-focused={props.focused ? 'true' : 'false'}
      data-readiness={session.readiness?.phase ?? 'unavailable'}
      aria-label={pane.label}
      onContextMenu={contextMenu.openContextMenu}
    >
      {actions.runsInOriginalCheckout && (
        <OriginalCheckoutBanner
          cwd={pane.cwd}
          restarting={actions.restartingInWorktree}
          onRestart={() => void actions.restartInWorktree()}
        />
      )}
      <div
        ref={containerRef}
        className={cn(
          'absolute inset-x-0 bottom-0 px-2 py-1',
          actions.runsInOriginalCheckout ? 'top-7' : 'top-0',
        )}
      />
      <TerminalStatusLayers
        model={{
          cwd: pane.cwd,
          errorMessage: session.errorMessage,
          exitCode,
          inputError: session.inputError,
          inputWaiting: session.inputWaiting,
          status: session.status,
        }}
        actions={{
          onRestart: () => void actions.restartShell(),
          onSendInputNow: () => void session.sendInputNow(),
        }}
      />
      <TerminalPortPreviews
        ports={ports}
        runsInOriginalCheckout={actions.runsInOriginalCheckout}
        onOpen={actions.openPort}
      />
      <TerminalPaneMenus
        toolbarRef={selectionToolbarRef}
        model={{
          contextMenu: contextMenu.contextMenu,
          selectionText: session.selectionText,
          toolbarPosition: selectionToolbar.position,
        }}
        actions={{
          addToolbarSelection: () =>
            void actions.addSelectionToChat(session.selectionText, session.getSelectionRange()),
          copyToolbarSelection: () => {
            actions.copySelection(session.selectionText)
            selectionToolbar.dismiss()
          },
          addContextSelection: () => {
            if (contextMenu.contextMenu !== null) {
              void actions.addSelectionToChat(
                contextMenu.contextMenu.selectedText,
                contextMenu.contextMenu.range,
              )
            }
          },
          copyContextSelection: () => {
            if (contextMenu.contextMenu !== null) {
              actions.copySelection(contextMenu.contextMenu.selectedText)
            }
          },
          paste: actions.pasteFromClipboard,
          closeContextMenu: contextMenu.closeContextMenu,
        }}
      />
    </section>
  )
}
