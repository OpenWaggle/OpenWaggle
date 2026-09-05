import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { terminalTabTitle } from '../lib/terminal-owner'
import type { TerminalTabState } from '../state/terminal-store'

export interface TerminalTabStripProps {
  readonly ownerKey: string
  readonly tabs: readonly TerminalTabState[]
  readonly activeTabId: string | null
  readonly activity: Record<string, string | null>
  readonly focusedPaneId: string | null
  readonly onSelectTab: (tabId: string) => void
  readonly onCloseTab: (tabId: string) => void
  readonly onRenameTab: (tabId: string, name: string | null) => void
}

/** Tab strip across the panel header: one entry per terminal tab of the session. */
export function TerminalTabStrip(props: TerminalTabStripProps) {
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {props.tabs.map((tab, index) => (
        <TabButton
          key={tab.id}
          tab={tab}
          index={index}
          activity={props.activity}
          ownerKey={props.ownerKey}
          active={tab.id === props.activeTabId}
          renaming={renamingTabId === tab.id}
          handlers={{
            onSelect: () => props.onSelectTab(tab.id),
            onStartRename: () => setRenamingTabId(tab.id),
            onFinishRename: (name) => {
              props.onRenameTab(tab.id, name)
              setRenamingTabId(null)
            },
            onClose: () => props.onCloseTab(tab.id),
          }}
        />
      ))}
    </div>
  )
}

interface TabButtonProps {
  readonly ownerKey: string
  readonly tab: TerminalTabState
  readonly index: number
  readonly activity: Record<string, string | null>
  readonly active: boolean
  readonly renaming: boolean
  readonly handlers: {
    readonly onSelect: () => void
    readonly onStartRename: () => void
    readonly onFinishRename: (name: string | null) => void
    readonly onClose: () => void
  }
}

function TabButton(props: TabButtonProps) {
  const title = terminalTabTitle(props.ownerKey, props.tab, props.index, props.activity)
  const [draft, setDraft] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!props.renaming) return
    renameInputRef.current?.focus()
  }, [props.renaming])

  if (props.renaming) {
    return (
      <form
        className="flex items-center"
        onSubmit={(event) => {
          event.preventDefault()
          props.handlers.onFinishRename(draft)
        }}
      >
        <input
          ref={renameInputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => props.handlers.onFinishRename(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') props.handlers.onFinishRename(null)
          }}
          className="w-28 rounded border border-border bg-bg px-1 py-0.5 text-xs text-text-primary outline-none"
          aria-label="Terminal name"
        />
      </form>
    )
  }

  return (
    <div
      className={cn(
        'group flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs',
        props.active
          ? 'bg-bg-hover text-text-primary'
          : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary',
      )}
    >
      <Button
        variant="unstyled"
        size="none"
        className="max-w-40 truncate"
        title={title}
        onClick={props.handlers.onSelect}
        onDoubleClick={props.handlers.onStartRename}
      >
        {title}
        {props.tab.panes.length > 1 ? ` (${props.tab.panes.length})` : ''}
      </Button>
      <Button
        variant="unstyled"
        size="none"
        className="hidden text-text-tertiary hover:text-text-primary group-hover:block"
        title="Close terminal"
        aria-label={`Close ${title}`}
        onClick={props.handlers.onClose}
      >
        ✕
      </Button>
    </div>
  )
}
