import type { BrowserPreviewControllerState } from '@shared/types/browser-preview'
import { Bot, MousePointer2 } from 'lucide-react'

interface BrowserPreviewControllerBadgeProps {
  readonly controller: BrowserPreviewControllerState
}

export function BrowserPreviewControllerBadge({ controller }: BrowserPreviewControllerBadgeProps) {
  const agentControlled = controller.kind === 'agent'
  const Icon = agentControlled ? Bot : MousePointer2
  return (
    <div
      className="pointer-events-none flex h-5 min-w-0 items-center gap-1 rounded-full border border-border/70 bg-bg/90 px-1.5 text-xs font-medium text-text-tertiary shadow-sm backdrop-blur"
      data-browser-preview-controller={controller.kind}
      title={agentControlled ? controller.action : 'Human control'}
    >
      <Icon className={agentControlled ? 'size-3 text-accent' : 'size-3'} />
      <span className="truncate">
        {agentControlled ? 'Agent controlling browser' : 'Human control'}
      </span>
    </div>
  )
}
