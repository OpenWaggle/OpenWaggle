import { lazy, Suspense } from 'react'
import { useProject } from '@/features/sessions/hooks'
import { cn } from '@/shared/lib/cn'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { useUIStore } from '@/shell/ui-store'

const LazyTerminalPanel = lazy(() =>
  import('@/features/terminal/components').then((module) => ({
    default: module.TerminalPanel,
  })),
)

export function WorkspaceTerminal() {
  const terminalOpen = useUIStore((s) => s.terminalOpen)
  const closeTerminal = useUIStore((s) => s.closeTerminal)
  const { projectPath } = useProject()

  return (
    <div
      className={cn(
        'overflow-hidden transition-[height] duration-200 ease-out',
        terminalOpen ? 'h-57' : 'h-0',
      )}
    >
      {terminalOpen && (
        <PanelErrorBoundary name="Terminal">
          <Suspense fallback={null}>
            <LazyTerminalPanel projectPath={projectPath} onClose={closeTerminal} />
          </Suspense>
        </PanelErrorBoundary>
      )}
    </div>
  )
}
