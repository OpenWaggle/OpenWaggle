import { Copy, Hash, PanelLeft } from 'lucide-react'
import { cn } from '@/lib/cn'
import { projectName } from '@/lib/format'

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
    <header className="drag-region flex shrink-0 items-center justify-between h-12 px-5 gap-3 bg-bg border-b border-border">
      {/* hdrLeft — gap 8 */}
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

        {/* Thread icon */}
        <Hash className="no-drag h-3.5 w-3.5 text-text-tertiary" />

        {/* Title */}
        <span className="no-drag text-[13px] font-medium text-text-primary">
          {conversationTitle ?? 'New thread'}
        </span>

        {/* Project pill — h20, padding [0,8], cornerRadius 4, bg #151922, stroke #1e2229 */}
        <span className="no-drag flex items-center h-5 px-2 rounded border border-border bg-bg-tertiary text-[11px] text-text-secondary">
          {projectName(projectPath)}
        </span>

        {/* Dots */}
        <span className="no-drag text-[16px] leading-none text-text-tertiary">···</span>
      </div>

      {/* hdrRight — gap 8 */}
      <div className="flex items-center gap-2">
        {/* Open button — h28, padding [0,10], cornerRadius 5, gap 4, stroke #252c36 */}
        <button
          type="button"
          className={cn(
            'no-drag flex items-center gap-1 h-7 px-2.5 rounded-[5px] border border-button-border',
            'transition-colors hover:bg-bg-hover',
            !projectPath && 'pointer-events-none opacity-30',
          )}
          disabled={!projectPath}
          title={projectPath ?? 'No project selected'}
        >
          <span className="text-[12px] font-medium text-text-primary">Open</span>
          <span className="text-[9px] text-text-tertiary">&#x2228;</span>
        </button>

        {/* Commit button — h28, padding [0,10], cornerRadius 5, gap 4, amber gradient */}
        <button
          type="button"
          className={cn(
            'no-drag flex items-center gap-1 h-7 px-2.5 rounded-[5px]',
            'bg-gradient-to-b from-accent to-accent-dim',
            'transition-opacity hover:opacity-90',
            !projectPath && 'pointer-events-none opacity-30',
          )}
          disabled={!projectPath}
          title="Commit changes"
        >
          <span className="text-[12px] font-semibold text-bg">Commit</span>
          <span className="text-[9px] text-bg/50">&#x2228;</span>
        </button>

        {/* Divider — w1 h20 */}
        <div className="w-px h-5 bg-border" />

        {/* Diff stats — gap 4 */}
        <div className="no-drag flex items-center gap-1">
          <span className="text-[12px] font-medium text-success">+441</span>
          <span className="text-[12px] font-medium text-[#e05c5c]">-348</span>
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
