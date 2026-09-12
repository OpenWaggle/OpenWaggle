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
  readonly onSelectTab: (tabId: string) => void
  readonly onCloseTab: (tabId: string) => void
  readonly onRenameTab: (tabId: string, name: string | null) => void
}

/** Tab strip across the panel header: one entry per terminal tab of the session. */
export function TerminalTabStrip(props: TerminalTabStripProps) {
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)

  return (
    <div
      role="tablist"
      aria-label="Terminal tabs"
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
    >
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
            onCancelRename: () => setRenamingTabId(null),
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
    readonly onCancelRename: () => void
    readonly onClose: () => void
  }
}

function TabButton(props: TabButtonProps) {
  const title = terminalTabTitle(
    props.ownerKey,
    props.tab,
    props.index,
    props.activity,
    props.tab.activePaneId,
  )
  const [draft, setDraft] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!props.renaming) return
    setDraft(props.tab.customName ?? title)
    const frame = requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [props.renaming, props.tab.customName, title])

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
            if (event.key === 'Escape') {
              event.preventDefault()
              props.handlers.onCancelRename()
            }
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
        role="tab"
        aria-selected={props.active}
        tabIndex={props.active ? 0 : -1}
        onClick={props.handlers.onSelect}
        onDoubleClick={props.handlers.onStartRename}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            event.preventDefault()
            props.handlers.onStartRename()
            return
          }
          if (event.key === 'Delete') {
            event.preventDefault()
            props.handlers.onClose()
            return
          }
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const tablist = event.currentTarget.closest('[role="tablist"]')
          const tabs = [...(tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]
          const current = tabs.indexOf(event.currentTarget)
          const nextIndex =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
          tabs[nextIndex]?.focus()
          tabs[nextIndex]?.click()
        }}
      >
        {title}
        {props.tab.panes.length > 1 ? ` (${props.tab.panes.length})` : ''}
      </Button>
      <Button
        variant="unstyled"
        size="none"
        className="opacity-0 text-text-tertiary hover:text-text-primary group-hover:opacity-100 group-focus-within:opacity-100"
        title="Close terminal tab (Delete)"
        aria-label={`Close ${title}`}
        aria-keyshortcuts="Delete"
        onClick={props.handlers.onClose}
      >
        ✕
      </Button>
    </div>
  )
}
