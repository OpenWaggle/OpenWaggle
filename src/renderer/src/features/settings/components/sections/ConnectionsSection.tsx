import { ChevronDown, ChevronRight, KeyRound, type LucideIcon, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useProviders } from '@/features/settings/hooks/useSettings'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
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
      <Button
        variant="unstyled"
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className={cn(
          'flex w-full items-start justify-between gap-4 rounded-md p-1 text-left transition-colors',
          'hover:bg-bg-hover focus-visible:outline-none',
        )}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon className="mt-0.5 size-4 shrink-0 text-text-tertiary" />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-text-primary">{title}</h3>
              <span className="rounded-md border border-border-light bg-bg px-1.5 py-0.5 text-xs font-medium text-text-tertiary">
                {count}
              </span>
            </div>
            <p className="max-w-180 text-xs leading-5 text-text-tertiary">{description}</p>
          </div>
        </div>
        <Chevron className="mt-1 size-4 shrink-0 text-text-tertiary" />
      </Button>

      {isOpen &&
        (count > 0 ? (
          <div className="overflow-hidden rounded-lg border border-border bg-bg">{children}</div>
        ) : (
          <p className="px-1 text-xs text-text-muted">{emptyText}</p>
        ))}
    </div>
  )
}

export function ConnectionsSection() {
  const { providerModels, isLoading, loadError } = useProviders()
  const [apiKeysOpen, setApiKeysOpen] = useState(false)
  const [oauthOpen, setOauthOpen] = useState(false)
  const apiKeyProviders = providerModels.filter((providerInfo) => providerInfo.auth.supportsApiKey)
  const oauthProviders = providerModels.filter((providerInfo) => providerInfo.auth.supportsOAuth)
  const loadingText = 'Loading providers…'

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-text-primary">Connections</h2>
        <p className="text-xs text-text-tertiary">
          Manage the available provider authentication methods.
        </p>
      </div>

      {loadError && (
        <p className="rounded-lg border border-error/25 bg-error/6 px-3 py-2 text-sm text-error-text">
          Failed to load providers: {loadError}
        </p>
      )}

      {isLoading && providerModels.length === 0 && (
        <p className="text-xs text-text-muted">Loading providers…</p>
      )}

      <AuthProviderGroup
        title="API Key Providers"
        description="Use API-key, environment, or custom-provider auth for key-based access."
        count={apiKeyProviders.length}
        isOpen={apiKeysOpen}
        icon={KeyRound}
        emptyText={isLoading ? loadingText : 'No API-key providers were reported.'}
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
        description="Connect with OAuth. OpenWaggle starts the provider login flow and opens your browser."
        count={oauthProviders.length}
        isOpen={oauthOpen}
        icon={ShieldCheck}
        emptyText={isLoading ? loadingText : 'Pi did not report any OAuth providers.'}
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

      <p className="text-xs text-text-tertiary">
        API keys are stored locally on your machine and never sent anywhere except to the respective
        API providers.
      </p>
    </div>
  )
}
