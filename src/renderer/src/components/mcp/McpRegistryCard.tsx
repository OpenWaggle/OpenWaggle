import { Globe, MessageSquare, Monitor, ShieldAlert, Wrench } from 'lucide-react'

interface McpRegistryCardProps {
  readonly name: string
  readonly icon: 'globe' | 'message-square' | 'shield-alert' | 'chrome' | 'wrench'
  readonly description: string
  readonly popular: boolean
  readonly isInstalling: boolean
  readonly onInstall: () => void
}

const ICON_MAP = {
  globe: Globe,
  'message-square': MessageSquare,
  'shield-alert': ShieldAlert,
  chrome: Monitor,
  wrench: Wrench,
}

export function McpRegistryCard({
  name,
  icon,
  description,
  popular,
  isInstalling,
  onInstall,
}: McpRegistryCardProps) {
  const Icon = ICON_MAP[icon]

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-bg p-[14px_16px]">
      <div className="flex items-center gap-2.5">
        {/* Icon */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-tertiary">
          <Icon className="h-[15px] w-[15px] text-text-tertiary" />
        </div>
        {/* Info */}
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-semibold text-text-primary">{name}</span>
          <span className="text-xs text-text-tertiary">{description}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {popular && (
          <span className="rounded-[10px] bg-bg-tertiary px-2 py-0.5 text-[10px] font-medium text-accent">
            Popular
          </span>
        )}
        <button
          type="button"
          onClick={onInstall}
          disabled={isInstalling}
          className="h-7 rounded-[5px] border border-[#2a2f3a] bg-[#1a1f28] px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-[#222830] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isInstalling ? 'Installing...' : 'Install'}
        </button>
      </div>
    </div>
  )
}
