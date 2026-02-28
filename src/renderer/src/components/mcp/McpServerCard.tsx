import type { McpServerStatus } from '@shared/types/mcp'
import { Database, Globe, HardDrive, Plug, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'

interface McpServerCardProps {
  readonly server: McpServerStatus
  readonly onToggle: (enabled: boolean) => void
  readonly onRemove: () => void
}

const ICON_MAP: Record<string, typeof HardDrive> = {
  filesystem: HardDrive,
  github: Globe,
  postgres: Database,
}

function ServerIcon({ name }: { name: string }): React.JSX.Element {
  const Icon = ICON_MAP[name.toLowerCase()] ?? Plug
  return <Icon className="h-[15px] w-[15px] text-accent" />
}

export function McpServerCard({
  server,
  onToggle,
  onRemove,
}: McpServerCardProps): React.JSX.Element {
  const isConnected = server.status === 'connected'
  const isConnecting = server.status === 'connecting'

  return (
    <div className="group flex items-center justify-between rounded-lg border border-border bg-bg-secondary p-[14px_16px]">
      <div className="flex items-center gap-2.5">
        {/* Icon */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-tertiary">
          <ServerIcon name={server.name} />
        </div>
        {/* Info */}
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-semibold text-text-primary">{server.name}</span>
          <span className="text-xs text-text-tertiary">
            {server.error ??
              (isConnecting ? 'Connecting...' : `${server.toolCount} tools available`)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Tool count badge */}
        {isConnected && server.toolCount > 0 && (
          <span className="rounded-[10px] bg-bg-tertiary px-2 py-0.5 text-[10px] font-medium text-text-tertiary">
            {server.toolCount} tools
          </span>
        )}

        {/* Remove button (visible on hover) */}
        <button
          type="button"
          onClick={onRemove}
          className="invisible rounded p-1 text-text-muted transition-colors hover:text-red-400 group-hover:visible"
          aria-label={`Remove ${server.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>

        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={isConnected || isConnecting}
          aria-label={`Toggle ${server.name}`}
          onClick={() => onToggle(!isConnected && !isConnecting)}
          className={cn(
            'relative h-5 w-9 shrink-0 rounded-[10px] transition-colors',
            isConnected || isConnecting ? 'bg-accent' : 'bg-bg-tertiary',
          )}
        >
          <span
            className={cn(
              'absolute top-[3px] left-[3px] h-[14px] w-[14px] rounded-full bg-white transition-transform',
              (isConnected || isConnecting) && 'translate-x-4',
            )}
          />
        </button>
      </div>
    </div>
  )
}
