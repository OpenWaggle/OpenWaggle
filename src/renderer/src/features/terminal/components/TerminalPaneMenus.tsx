import type { RefObject } from 'react'
import type { TerminalPaneContextMenuState } from '../hooks/useTerminalPaneContextMenu'
import { TerminalPaneContextMenu } from './TerminalPaneContextMenu'
import { TerminalSelectionToolbar } from './TerminalPaneLayers'

interface TerminalPaneMenusProps {
  readonly toolbarRef: RefObject<HTMLDivElement | null>
  readonly model: {
    readonly contextMenu: TerminalPaneContextMenuState | null
    readonly selectionText: string
    readonly toolbarPosition: { readonly x: number; readonly y: number } | null
  }
  readonly actions: {
    readonly addContextSelection: () => void
    readonly addToolbarSelection: () => void
    readonly closeContextMenu: () => void
    readonly copyContextSelection: () => void
    readonly copyToolbarSelection: () => void
    readonly paste: () => void
  }
}

export function TerminalPaneMenus(props: TerminalPaneMenusProps) {
  const { contextMenu } = props.model
  return (
    <>
      {contextMenu === null && (
        <TerminalSelectionToolbar
          toolbarRef={props.toolbarRef}
          selectionText={props.model.selectionText}
          position={props.model.toolbarPosition}
          onAddToChat={props.actions.addToolbarSelection}
          onCopy={props.actions.copyToolbarSelection}
        />
      )}
      <TerminalPaneContextMenu
        open={contextMenu !== null}
        position={contextMenu?.position ?? { x: 0, y: 0 }}
        hasSelection={(contextMenu?.selectedText.length ?? 0) > 0}
        onAddToChat={props.actions.addContextSelection}
        onCopy={props.actions.copyContextSelection}
        onPaste={props.actions.paste}
        onClose={props.actions.closeContextMenu}
      />
    </>
  )
}
