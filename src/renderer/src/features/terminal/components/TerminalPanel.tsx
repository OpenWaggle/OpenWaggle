import { X } from 'lucide-react'
import { useTerminalSession } from '@/features/terminal/hooks/useTerminalSession'
import '@xterm/xterm/css/xterm.css'
import { Button } from '@/shared/ui/Button'

interface TerminalPanelProps {
  projectPath: string | null
  onClose: () => void
}

function getTerminalLabel(status: {
  readonly isReady: boolean
  readonly errorMessage: string | null
}) {
  if (status.errorMessage) return 'unavailable'
  return status.isReady ? '/bin/zsh' : 'connecting...'
}

export function TerminalPanel({ projectPath, onClose }: TerminalPanelProps) {
  const { containerRef, terminalStatus } = useTerminalSession(projectPath)

  return (
    <div className="flex shrink-0 flex-col border-t border-border bg-bg h-full">
      <div className="flex h-8 items-center justify-between border-b border-border px-3">
        <span className="text-[13px] text-text-secondary">
          Terminal {getTerminalLabel(terminalStatus)}
        </span>
        <Button
          variant="unstyled"
          type="button"
          onClick={onClose}
          className="flex items-center justify-center rounded p-0.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title="Close terminal"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div ref={containerRef} className="flex-1 overflow-hidden p-1" />
      {terminalStatus.errorMessage && (
        <div className="border-t border-border px-3 py-2 text-[12px] text-error">
          {terminalStatus.errorMessage}
        </div>
      )}
    </div>
  )
}
