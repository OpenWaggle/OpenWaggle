import type { ProviderInfo } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { PROVIDER_META } from './meta'

interface AddProviderRowProps {
  availableProviders: ProviderInfo[]
  onAdd: (provider: Provider) => void
}

export function AddProviderRow({
  availableProviders,
  onAdd,
}: AddProviderRowProps): React.JSX.Element | null {
  const [showDropdown, setShowDropdown] = useState(false)

  if (availableProviders.length === 0) return null

  return (
    <div className="relative flex items-center justify-center h-12 px-5">
      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        className={cn(
          'flex items-center gap-1.5 rounded-md border border-input-card-border bg-[#1a1f28] px-3.5 h-8',
          'text-[12px] font-medium text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        Add provider key
      </button>

      {showDropdown && (
        <div className="absolute top-full mt-1 z-10 rounded-lg border border-border bg-bg-secondary shadow-xl py-1 min-w-[200px]">
          {availableProviders.map((providerEntry) => {
            const meta = PROVIDER_META[providerEntry.provider]
            const Icon = meta.icon

            return (
              <button
                key={providerEntry.provider}
                type="button"
                onClick={() => {
                  onAdd(providerEntry.provider)
                  setShowDropdown(false)
                }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-text-secondary hover:bg-bg-hover transition-colors"
              >
                <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
                {providerEntry.displayName}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
