import { ChevronDown, ChevronRight, KeyRound, type LucideIcon, ShieldCheck } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { useRef, useState } from 'react'
import { useProviderCatalogRetry, useProviders } from '@/features/settings/hooks/useSettings'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { AvailableModelsSection } from './connections/AvailableModelsSection'
import { OAuthProviderRow } from './connections/OAuthProviderRow'
import { ProviderRow } from './connections/ProviderRow'
import { SourceControlSection } from './connections/SourceControlSection'
import { TitleModelSection } from './connections/TitleModelSection'

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

interface ProviderCatalogLoadErrorProps {
  readonly loadError: string | null
  /** Takes focus when a retry succeeds and the banner, with its focused button, goes away. */
  readonly headingRef: RefObject<HTMLHeadingElement | null>
}

/**
 * A provider catalog that failed to load, with a retry that reloads it and its sign-in accounts.
 * The banner stays while the retry runs, so a failed retry leaves focus on Retry and says it failed,
 * even when the error text is the same. A successful retry moves focus to the section heading,
 * unless the user has moved it elsewhere meanwhile.
 */
function ProviderCatalogLoadError({ loadError, headingRef }: ProviderCatalogLoadErrorProps) {
  const retryProviderCatalog = useProviderCatalogRetry()
  const retryRef = useRef<HTMLButtonElement>(null)
  const [retryingAfter, setRetryingAfter] = useState<string | null>(null)
  const [failedRetries, setFailedRetries] = useState(0)
  const message = loadError ?? retryingAfter
  if (message === null) return null
  const retrying = retryingAfter !== null

  async function retry() {
    if (retrying || loadError === null) return
    setRetryingAfter(loadError)
    const loaded = await retryProviderCatalog()
    setRetryingAfter(null)
    if (!loaded) {
      setFailedRetries((count) => count + 1)
      return
    }
    // A later failure from another path starts a new count, so it never reports this one.
    setFailedRetries(0)
    const focused = document.activeElement
    if (focused === null || focused === document.body || focused === retryRef.current) {
      headingRef.current?.focus()
    }
  }

  return (
    <>
      <div
        role="alert"
        aria-busy={retrying}
        className="flex items-start justify-between gap-3 rounded-lg border border-error/25 bg-error/6 px-3 py-2"
      >
        <p className="min-w-0 text-sm text-error-text">Failed to load providers: {message}</p>
        <Button
          ref={retryRef}
          variant="secondary"
          aria-label="Retry loading providers"
          aria-disabled={retrying || undefined}
          onClick={() => void retry()}
          className="shrink-0"
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </Button>
      </div>
      <span role="status" className="sr-only">
        {failedRetries > 0 && !retrying ? `Retry ${failedRetries} failed.` : ''}
      </span>
    </>
  )
}

export function ConnectionsSection() {
  const { providerModels, isLoading, loadError } = useProviders()
  const [apiKeysOpen, setApiKeysOpen] = useState(false)
  const [oauthOpen, setOauthOpen] = useState(false)
  const apiKeyProviders = providerModels.filter((providerInfo) => providerInfo.auth.supportsApiKey)
  const oauthProviders = providerModels.filter((providerInfo) => providerInfo.auth.supportsOAuth)
  const loadingText = 'Loading providers…'
  const headingRef = useRef<HTMLHeadingElement>(null)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold text-text-primary focus-visible:outline-none"
        >
          Connections
        </h2>
        <p className="text-xs text-text-tertiary">
          Manage provider authentication and source control hosts.
        </p>
      </div>

      <ProviderCatalogLoadError loadError={loadError} headingRef={headingRef} />

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
        emptyText={isLoading ? loadingText : 'No sign-in providers are available.'}
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

      <SourceControlSection />

      <AvailableModelsSection />

      <TitleModelSection />

      <p className="text-xs text-text-tertiary">
        API keys are stored locally on your machine and never sent anywhere except to the respective
        API providers.
      </p>
    </div>
  )
}
