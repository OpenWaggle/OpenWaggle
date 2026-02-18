import { Copy, MoreHorizontal, PanelLeft, Play } from 'lucide-react'
import { cn } from '@/lib/cn'

interface HeaderProps {
  conversationTitle: string | null
  projectPath: string | null
  onToggleSidebar: () => void
  sidebarOpen: boolean
}

export function Header({
  conversationTitle,
  projectPath,
  onToggleSidebar,
  sidebarOpen,
}: HeaderProps): React.JSX.Element {
  return (
    <header className="drag-region flex h-12 shrink-0 items-center justify-between border-b border-border bg-bg px-5">
      <div className="flex items-center gap-2">
        {!sidebarOpen && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="no-drag rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
            title="Show sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}

        <Play className="no-drag h-3.5 w-3.5 text-text-secondary" />

        <span className="no-drag text-[13px] font-medium text-text-primary">
          {conversationTitle ?? 'New thread'}
        </span>

        <span className="no-drag rounded border border-border bg-bg-tertiary px-2 py-0.5 text-[11px] text-text-secondary">
          HiveCode
        </span>

        <button
          type="button"
          className="no-drag text-text-tertiary transition-colors hover:text-text-secondary"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        {/* Open button */}
        <button
          type="button"
          className={cn(
            'no-drag flex h-7 items-center rounded-[5px] border border-button-border px-2.5 text-[12px] font-medium text-text-primary',
            'transition-colors hover:border-border-light hover:bg-bg-hover',
            !projectPath && 'pointer-events-none opacity-30',
          )}
          disabled={!projectPath}
          title={projectPath ?? 'No project selected'}
        >
          Open
        </button>

        {/* Commit button — amber gradient */}
        <button
          type="button"
          className={cn(
            'no-drag flex h-7 items-center rounded-[5px] px-2.5 text-[12px] font-semibold text-bg',
            'bg-gradient-to-b from-accent to-accent-dim',
            'transition-opacity hover:opacity-90',
            !projectPath && 'pointer-events-none opacity-30',
          )}
          disabled={!projectPath}
          title="Commit changes"
        >
          Commit
        </button>

        {/* Divider */}
        <div className="h-5 w-px bg-border" />

        {/* Diff stats */}
        <div className="no-drag flex items-center gap-1 text-[12px] font-medium">
          <span className="text-success">+441</span>
          <span className="text-error">-348</span>
        </div>

        {/* Copy icon */}
        <button
          type="button"
          className="no-drag text-text-tertiary transition-colors hover:text-text-secondary"
          title="Copy"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  )
}
