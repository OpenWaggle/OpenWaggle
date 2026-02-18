import { ChevronDown, GitBranch, Monitor, Shield } from 'lucide-react'

interface StatusBarProps {
  projectPath: string | null
}

export function StatusBar({ projectPath }: StatusBarProps): React.JSX.Element {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between border-t border-border bg-bg px-8 text-[11px] text-text-tertiary">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <Monitor className="h-3.5 w-3.5" />
          Local 0%
          <ChevronDown className="h-2.5 w-2.5 opacity-50" />
        </span>

        <span className="flex items-center gap-1.5 text-success/80">
          <Shield className="h-3.5 w-3.5" />
          Full access
          <ChevronDown className="h-2.5 w-2.5 opacity-50" />
        </span>
      </div>

      {projectPath && (
        <span className="flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5" />
          main
          <ChevronDown className="h-2.5 w-2.5 opacity-50" />
        </span>
      )}
    </div>
  )
}
