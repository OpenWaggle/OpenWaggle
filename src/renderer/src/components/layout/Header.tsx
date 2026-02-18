import { ChevronDown, FolderOpen, GitBranch, PanelLeft } from 'lucide-react'
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
    <header className="drag-region flex h-12 shrink-0 items-center justify-between border-b border-border bg-bg px-6">
      <div className="flex items-center gap-3">
        {!sidebarOpen && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="no-drag rounded-md p-1.5 text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
            title="Show sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}

        <span className="no-drag text-sm font-medium text-text-primary">
          {conversationTitle ?? 'New thread'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={cn(
            'no-drag flex items-center gap-1.5 rounded-lg border border-border-light px-3 py-1.5 text-xs font-medium text-text-secondary',
            'hover:bg-bg-hover hover:text-text-primary transition-colors',
            !projectPath && 'opacity-30 pointer-events-none',
          )}
          disabled={!projectPath}
          title={projectPath ?? 'No project selected'}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Open
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>

        <button
          type="button"
          className={cn(
            'no-drag flex items-center gap-1.5 rounded-lg border border-border-light px-3 py-1.5 text-xs font-medium text-text-secondary',
            'hover:bg-bg-hover hover:text-text-primary transition-colors',
            !projectPath && 'opacity-30 pointer-events-none',
          )}
          disabled={!projectPath}
          title="Commit changes"
        >
          <GitBranch className="h-3.5 w-3.5" />
          Commit
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </div>
    </header>
  )
}
