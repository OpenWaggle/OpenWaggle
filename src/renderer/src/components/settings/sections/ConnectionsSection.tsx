import { ChevronDown, ChevronRight, KeyRound, type LucideIcon, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useProviders } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'
import { AvailableModelsSection } from './connections/AvailableModelsSection'
import { OAuthProviderRow } from './connections/OAuthProviderRow'
import { ProviderRow } from './connections/ProviderRow'

interface AuthProviderGroupProps {
  readonly title: string
  readonly description: string
  readonly count: number
  readonly isOpen: boolean
  readonly icon: LucideIcon
  readonly emptyText: string
  readonly onToggle: () => void
  readonly children: ReactNode
}

function AuthProviderGroup({
  title,
  description,
  count,
  isOpen,
  icon: Icon,
  emptyText,
  onToggle,
  children,
}: AuthProviderGroupProps) {
  const Chevron = isOpen ? ChevronDown : ChevronRight

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className={cn(
          'flex w-full items-start justify-between gap-4 rounded-md px-1 py-1 text-left transition-colors',
          'hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-light',
        )}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[16px] font-semibold text-text-primary">{title}</h3>
              <span className="rounded-md border border-input-card-border bg-[#151a22] px-1.5 py-0.5 text-[11px] font-medium text-text-tertiary">
                {count}
              </span>
            </div>
            <p className="max-w-[720px] text-[12px] leading-5 text-text-tertiary">{description}</p>
          </div>
        </div>
        <Chevron className="mt-1 h-4 w-4 shrink-0 text-text-tertiary" />
      </button>

      {isOpen &&
        (count > 0 ? (
          <div className="overflow-hidden rounded-lg border border-border bg-[#111418]">
            {children}
          </div>
        ) : (
          <p className="px-1 text-[13px] text-text-muted">{emptyText}</p>
        ))}
    </div>
  )
}

export function ConnectionsSection() {
  const { providerModels } = useProviders()
  const [apiKeysOpen, setApiKeysOpen] = useState(false)
  const [oauthOpen, setOauthOpen] = useState(false)
  const apiKeyProviders = providerModels.filter((providerInfo) => providerInfo.auth.supportsApiKey)
  const oauthProviders = providerModels.filter((providerInfo) => providerInfo.auth.supportsOAuth)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-[20px] font-semibold text-text-primary">Connections</h2>
        <p className="text-[13px] text-text-tertiary">
          Manage the provider authentication methods available through Pi.
        </p>
      </div>

      <AuthProviderGroup
        title="API Key Providers"
        description="Use Pi's API-key, environment, or custom-provider auth for key-based access."
        count={apiKeyProviders.length}
        isOpen={apiKeysOpen}
        icon={KeyRound}
        emptyText="Pi did not report any API-key providers."
        onToggle={() => setApiKeysOpen((open) => !open)}
      >
        {apiKeyProviders.map((providerInfo, index) => (
          <ProviderRow
            key={providerInfo.provider}
            providerInfo={providerInfo}
            isLast={index === apiKeyProviders.length - 1}
          />
        ))}
      </AuthProviderGroup>

      <AuthProviderGroup
        title="OAuth Providers"
        description="Connect with Pi OAuth. OpenWaggle starts Pi's login flow and opens your browser."
        count={oauthProviders.length}
        isOpen={oauthOpen}
        icon={ShieldCheck}
        emptyText="Pi did not report any OAuth providers."
        onToggle={() => setOauthOpen((open) => !open)}
      >
        {oauthProviders.map((providerInfo, index) => (
          <OAuthProviderRow
            key={providerInfo.provider}
            providerInfo={providerInfo}
            isLast={index === oauthProviders.length - 1}
          />
        ))}
      </AuthProviderGroup>

      <AvailableModelsSection />

      <p className="text-[13px] text-text-tertiary">
        API keys are stored locally on your machine and never sent anywhere except to the respective
        API providers.
      </p>
    </div>
  )
}
