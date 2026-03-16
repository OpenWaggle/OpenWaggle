import { PanelErrorBoundary } from '@/components/shared/PanelErrorBoundary'
import { TerminalPanel } from '@/components/terminal/TerminalPanel'
import { useProject } from '@/hooks/useProject'
import { cn } from '@/lib/cn'
import { useUIStore } from '@/stores/ui-store'

export function WorkspaceTerminal() {
  const terminalOpen = useUIStore((s) => s.terminalOpen)
  const closeTerminal = useUIStore((s) => s.closeTerminal)
  const { projectPath } = useProject()

  return (
    <div
      className={cn(
        'overflow-hidden transition-[height] duration-200 ease-out',
        terminalOpen ? 'h-[228px]' : 'h-0',
      )}
    >
      {terminalOpen && (
        <PanelErrorBoundary name="Terminal">
          <TerminalPanel projectPath={projectPath} onClose={closeTerminal} />
        </PanelErrorBoundary>
      )}
    </div>
  )
}
