import { Lock } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import {
  type ActionOutputView,
  actionOutputViewTabId,
  actionOutputViewTitle,
} from '../lib/action-output-view-model'
import { selectAdjacentTerminalTab } from '../lib/terminal-tab-keyboard'

interface ActionOutputViewTabsProps {
  readonly views: readonly ActionOutputView[]
  readonly shownActionId: string | null
  readonly onSelect: (actionId: string) => void
  readonly onClose: (actionId: string) => void
}

/** Read-only action output tabs, rendered inside the terminal tab strip's tablist. */
export function ActionOutputViewTabs(props: ActionOutputViewTabsProps) {
  return props.views.map((view) => {
    const title = actionOutputViewTitle(view)
    const active = view.actionId === props.shownActionId
    return (
      <div
        key={view.actionId}
        className={cn(
          'group flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs',
          active
            ? 'bg-bg-hover text-text-primary'
            : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary',
        )}
      >
        <Button
          id={actionOutputViewTabId(view)}
          variant="unstyled"
          size="none"
          className="flex max-w-48 items-center gap-1 truncate"
          title={`${title} (read-only)`}
          role="tab"
          aria-selected={active}
          aria-label={`${title}, read-only`}
          tabIndex={active ? 0 : -1}
          onClick={() => props.onSelect(view.actionId)}
          onKeyDown={(event) => {
            if (selectAdjacentTerminalTab(event) || event.key !== 'Delete') return
            event.preventDefault()
            props.onClose(view.actionId)
          }}
        >
          <Lock className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{title}</span>
        </Button>
        <Button
          variant="unstyled"
          size="none"
          className="opacity-0 text-text-tertiary hover:text-text-primary group-hover:opacity-100 group-focus-within:opacity-100"
          title="Close this view (the action keeps running)"
          aria-label={`Close ${title}`}
          onClick={() => props.onClose(view.actionId)}
        >
          ✕
        </Button>
      </div>
    )
  })
}
