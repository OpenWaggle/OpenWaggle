import type {
  OAuthFlowStatus,
  SubscriptionAccountInfo,
  SubscriptionProvider,
} from '@shared/types/auth'
import type { ProviderInfo } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  AnthropicIcon,
  GeminiIcon,
  GrokIcon,
  OllamaIcon,
  OpenAIIcon,
  OpenRouterIcon,
} from '@/components/icons/provider-icons'
import { useSettings } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'

// Provider visual metadata — official logos, colors, descriptions
const PROVIDER_META: Record<
  Provider,
  {
    icon: typeof OpenAIIcon
    color: string
    description: string
  }
> = {
  openai: {
    icon: OpenAIIcon,
    color: '#10a37f',
    description: 'GPT-4o, o1, o3 and other OpenAI models',
  },
  anthropic: {
    icon: AnthropicIcon,
    color: '#d4a27f',
    description: 'Claude Sonnet, Opus, Haiku models',
  },
  gemini: {
    icon: GeminiIcon,
    color: '#4285f4',
    description: 'Gemini 2.5 Pro, Flash and other Google AI models',
  },
  grok: {
    icon: GrokIcon,
    color: '#e44d26',
    description: 'Grok models from xAI',
  },
  openrouter: {
    icon: OpenRouterIcon,
    color: '#7c5cfc',
    description: 'Access models from multiple providers via OpenRouter',
  },
  ollama: {
    icon: OllamaIcon,
    color: '#555d6e',
    description: 'Run open-source models locally with Ollama',
  },
}

// Subscription connection visual metadata — per-provider branding for the SDK card
const SUBSCRIPTION_META: Record<
  SubscriptionProvider,
  {
    icon: typeof OpenAIIcon
    iconColor: string
    connectedLogoBg: string
    connectedLogoBorder: string
    disconnectedLogoBg: string
    disconnectedLogoBorder: string
    name: string
    description: string
    tosWarning?: string
  }
> = {
  anthropic: {
    icon: AnthropicIcon,
    iconColor: '#d4a27f',
    connectedLogoBg: '#1a1520',
    connectedLogoBorder: '#2a2040',
    disconnectedLogoBg: '#111418',
    disconnectedLogoBorder: '#1e2229',
    name: 'Anthropic Subscription',
    description: 'Sign in with your Claude Pro/Max subscription',
    tosWarning:
      "Anthropic's Terms of Service prohibit using subscription OAuth tokens in third-party applications. After signing in, copy the authorization code from the browser — it will be picked up from your clipboard automatically.",
  },
  openai: {
    icon: OpenAIIcon,
    iconColor: '#10a37f',
    connectedLogoBg: '#0f1a14',
    connectedLogoBorder: '#1a3025',
    disconnectedLogoBg: '#111418',
    disconnectedLogoBorder: '#1e2229',
    name: 'OpenAI Subscription',
    description: 'Sign in with your ChatGPT Plus/Pro subscription',
    tosWarning:
      "Uses OpenAI's Codex authentication flow. This is not officially supported for third-party applications.",
  },
  openrouter: {
    icon: OpenRouterIcon,
    iconColor: '#7c5cfc',
    connectedLogoBg: '#13111f',
    connectedLogoBorder: '#251f40',
    disconnectedLogoBg: '#111418',
    disconnectedLogoBorder: '#1e2229',
    name: 'OpenRouter Subscription',
    description: 'Sign in with your OpenRouter account',
  },
}

const SUBSCRIPTION_PROVIDER_ORDER: SubscriptionProvider[] = ['openrouter', 'openai', 'anthropic']

function maskApiKey(key: string): string {
  if (!key || key.length < 8) return ''
  const prefix = key.slice(0, key.indexOf('-') > 0 ? key.indexOf('-', key.indexOf('-') + 1) + 1 : 4)
  const suffix = key.slice(-4)
  const visiblePrefix = prefix.length > 8 ? prefix.slice(0, 8) : prefix
  return `${visiblePrefix}${'••••••'}${suffix}`
}

// ─── Key Editor (inline form for API key management) ─────────────────────────

function KeyEditor({
  provider,
  providerInfo,
  currentKey,
  onSave,
  onTest,
  isTesting,
  testResult,
  onClose,
}: {
  provider: Provider
  providerInfo: ProviderInfo
  currentKey: string
  onSave: (key: string) => Promise<void>
  onTest: (key: string) => Promise<boolean>
  isTesting: boolean
  testResult: { success: boolean; error?: string } | null
  onClose: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(currentKey)
  const [showKey, setShowKey] = useState(!currentKey)
  const hasChanged = value !== currentKey

  useEffect(() => {
    setValue(currentKey)
  }, [currentKey])

  async function handleSave(): Promise<void> {
    await onSave(value)
    onClose()
  }

  async function handleTest(): Promise<void> {
    await onTest(value)
  }

  return (
    <div className="border-t border-border px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-text-secondary">API Key</span>
        <div className="flex items-center gap-2">
          {providerInfo.apiKeyManagementUrl && (
            <a
              href={providerInfo.apiKeyManagementUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-link-yellow hover:opacity-90 transition-opacity"
            >
              Get API key
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type={showKey ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`Enter your ${providerInfo.displayName} API key`}
            className={cn(
              'w-full rounded-lg border border-input-card-border bg-bg px-3 py-2 pr-9 text-[13px] text-text-primary font-mono',
              'placeholder:text-text-muted placeholder:font-sans',
              'focus:border-border-light focus:outline-none',
              'transition-colors',
            )}
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
          >
            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>

        <button
          type="button"
          onClick={handleTest}
          disabled={!value || isTesting}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-medium transition-colors',
            value && !isTesting
              ? 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-input-card-border'
              : 'bg-bg-tertiary text-text-muted cursor-not-allowed border border-input-card-border',
          )}
        >
          {isTesting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Testing
            </>
          ) : (
            'Test'
          )}
        </button>

        <button
          type="button"
          onClick={handleSave}
          disabled={!hasChanged}
          className={cn(
            'rounded-md px-3 py-2 text-[12px] font-medium transition-colors',
            hasChanged
              ? 'bg-accent text-black hover:bg-accent/90'
              : 'bg-bg-tertiary text-text-muted cursor-not-allowed border border-input-card-border',
          )}
        >
          Save
        </button>
      </div>

      {testResult && (
        <div
          className={cn(
            'flex items-center gap-1.5 text-[12px]',
            testResult.success ? 'text-success' : 'text-error',
          )}
        >
          {testResult.success ? (
            <>
              <Check className="h-3 w-3" />
              Connection successful
            </>
          ) : (
            <>
              <X className="h-3 w-3" />
              {testResult.error ?? 'Connection failed — check your API key'}
            </>
          )}
        </div>
      )}

      {providerInfo.supportsBaseUrl && <BaseUrlField provider={provider} />}
    </div>
  )
}

function BaseUrlField({ provider }: { provider: Provider }): React.JSX.Element {
  const settings = useSettings()
  const config = settings.settings.providers[provider]
  const [localValue, setLocalValue] = useState(config?.baseUrl ?? '')

  useEffect(() => {
    setLocalValue(config?.baseUrl ?? '')
  }, [config?.baseUrl])

  return (
    <div className="space-y-1.5">
      <span className="text-[12px] text-text-tertiary">Base URL</span>
      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => {
          if (localValue !== (config?.baseUrl ?? '')) {
            settings.updateBaseUrl(provider, localValue)
          }
        }}
        placeholder="http://localhost:11434"
        className={cn(
          'w-full rounded-lg border border-input-card-border bg-bg px-3 py-2 text-[12px] text-text-primary font-mono',
          'placeholder:text-text-muted placeholder:font-sans',
          'focus:border-border-light focus:outline-none',
          'transition-colors',
        )}
      />
    </div>
  )
}

// ─── API Keys: Provider Row ──────────────────────────────────────────────────

function ProviderRow({
  providerInfo,
  isLast,
  autoEdit,
  onEditingChange,
  fetchError,
}: {
  providerInfo: ProviderInfo
  isLast: boolean
  autoEdit?: boolean
  onEditingChange?: (editing: boolean) => void
  fetchError?: string
}): React.JSX.Element {
  const { settings, testingProviders, testResults, updateApiKey, testApiKey } = useSettings()

  const [editing, setEditing] = useState(autoEdit ?? false)
  const providerId = providerInfo.provider
  const config = settings.providers[providerId]
  const meta = PROVIDER_META[providerId]
  const currentKey = config?.apiKey ?? ''
  const masked = maskApiKey(currentKey)
  const isTesting = testingProviders[providerId] ?? false

  const Icon = meta.icon

  return (
    <div className={cn(!isLast && 'border-b border-border')}>
      {/* Main row */}
      <div className="flex items-center justify-between h-16 px-5">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} />
            <span className="text-[13px] font-medium text-text-primary">
              {providerInfo.displayName}
            </span>
          </div>
          <span className="text-[12px] text-text-tertiary">{meta.description}</span>
        </div>

        <div className="flex items-center gap-2.5">
          {currentKey && (
            <div className="flex items-center rounded-[5px] border border-input-card-border bg-[#1a1f28] px-3 h-7">
              <span className="text-[11px] text-text-tertiary font-mono">{masked}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              const next = !editing
              setEditing(next)
              onEditingChange?.(next)
            }}
            className={cn(
              'flex items-center justify-center rounded-[5px] border border-input-card-border bg-[#1a1f28] h-7 w-7',
              'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors',
            )}
          >
            <Pencil className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Expanded editor — API key only, no subscription auth */}
      {editing && (
        <KeyEditor
          provider={providerId}
          providerInfo={providerInfo}
          currentKey={currentKey}
          onSave={(key) => updateApiKey(providerId, key)}
          onTest={(key) => testApiKey(providerId, key, config?.baseUrl)}
          isTesting={isTesting}
          testResult={testResults[providerId] ?? null}
          onClose={() => setEditing(false)}
        />
      )}

      {/* Model fetch error — shown when dynamic model list fetch fails */}
      {fetchError && !editing && (
        <div className="flex items-start gap-2 mx-5 mb-3 rounded-lg border border-warning/25 bg-warning/6 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning mt-0.5" />
          <p className="text-[11px] leading-relaxed text-warning/80">
            Could not fetch models: {fetchError}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── API Keys: Add Provider Row ──────────────────────────────────────────────

function AddProviderRow({
  availableProviders,
  onAdd,
}: {
  availableProviders: ProviderInfo[]
  onAdd: (provider: Provider) => void
}): React.JSX.Element | null {
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
          {availableProviders.map((p) => {
            const meta = PROVIDER_META[p.provider]
            const Icon = meta.icon
            return (
              <button
                key={p.provider}
                type="button"
                onClick={() => {
                  onAdd(p.provider)
                  setShowDropdown(false)
                }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-text-secondary hover:bg-bg-hover transition-colors"
              >
                <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
                {p.displayName}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── SDK Connections: Subscription Row ────────────────────────────────────────

function SubscriptionRow({
  provider,
  accountInfo,
  oauthStatus,
  onSignIn,
  onDisconnect,
  onSubmitCode,
  isLast,
}: {
  provider: SubscriptionProvider
  accountInfo: SubscriptionAccountInfo | null | undefined
  oauthStatus: OAuthFlowStatus
  onSignIn: () => void
  onDisconnect: () => void
  onSubmitCode?: (code: string) => void
  isLast: boolean
}): React.JSX.Element {
  const meta = SUBSCRIPTION_META[provider]
  const Icon = meta.icon
  const connected = accountInfo?.connected ?? false
  const isBusy =
    oauthStatus.type === 'in-progress' ||
    oauthStatus.type === 'awaiting-code' ||
    oauthStatus.type === 'code-received'
  const isAwaitingCode = oauthStatus.type === 'awaiting-code'
  const isCodeReceived = oauthStatus.type === 'code-received'
  const isError = oauthStatus.type === 'error'

  const [pasteValue, setPasteValue] = useState('')

  const statusColor = connected ? '#34d399' : '#555d6e'
  const statusText = connected ? 'Connected' : 'Disconnected'
  const logoBg = connected ? meta.connectedLogoBg : meta.disconnectedLogoBg
  const logoBorder = connected ? meta.connectedLogoBorder : meta.disconnectedLogoBorder
  const iconColor = connected ? meta.iconColor : '#555d6e'

  function handleToggle(): void {
    if (connected) {
      onDisconnect()
    } else {
      onSignIn()
    }
  }

  function handleSubmitCode(): void {
    const trimmed = pasteValue.trim()
    if (trimmed && onSubmitCode) {
      onSubmitCode(trimmed)
      setPasteValue('')
    }
  }

  const codeHelpText =
    provider === 'openai'
      ? 'If automatic redirect capture fails, paste the full callback URL from your browser address bar (preferred), or paste "code#state".'
      : 'Copy the authorization code from the browser page. It will be detected automatically from your clipboard, or you can paste it below.'
  const codePlaceholder =
    provider === 'openai' ? 'Paste callback URL or code#state' : 'Paste code here (code#state)'

  return (
    <div className={cn(!isLast && 'border-b border-border')}>
      <div className="flex items-center justify-between h-[68px] px-5">
        {/* Left: logo + info */}
        <div className="flex items-center gap-3.5">
          <div
            className="flex items-center justify-center h-9 w-9 rounded-lg border"
            style={{ backgroundColor: logoBg, borderColor: logoBorder }}
          >
            <Icon className="h-[18px] w-[18px]" style={{ color: iconColor }} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-text-primary">{meta.name}</span>
            <span className="text-[11px] text-text-tertiary">{meta.description}</span>
          </div>
        </div>

        {/* Right: status badge + toggle */}
        <div className="flex items-center gap-3">
          {isBusy ? (
            <div className="flex items-center gap-1.5 px-2 h-[22px]">
              {isCodeReceived ? (
                <Check className="h-3 w-3 text-success" />
              ) : (
                <Loader2 className="h-3 w-3 animate-spin text-accent" />
              )}
              <span
                className={cn(
                  'text-[11px] font-medium',
                  isCodeReceived ? 'text-success' : 'text-accent',
                )}
              >
                {isCodeReceived
                  ? 'Code detected! Completing sign in...'
                  : isAwaitingCode
                    ? 'Waiting for code...'
                    : 'Signing in...'}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-[10px] px-2 h-[22px]">
              <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
              <span className="text-[11px] font-medium" style={{ color: statusColor }}>
                {statusText}
              </span>
            </div>
          )}

          {/* Toggle */}
          <button
            type="button"
            onClick={handleToggle}
            disabled={isBusy}
            className={cn(
              'relative w-9 h-5 rounded-full transition-colors',
              isBusy && 'opacity-50 cursor-not-allowed',
              connected ? 'bg-accent' : 'bg-[#2a2f3a]',
            )}
          >
            <div
              className={cn(
                'absolute top-[3px] h-3.5 w-3.5 rounded-full transition-all',
                connected ? 'left-5 bg-white' : 'left-[2px] bg-text-tertiary',
              )}
            />
          </button>
        </div>
      </div>

      {/* Paste authorization code input (Anthropic) */}
      {isAwaitingCode && (
        <div className="mx-5 mb-3 space-y-2">
          <p className="text-[11px] text-text-tertiary">{codeHelpText}</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmitCode()
              }}
              placeholder={codePlaceholder}
              className={cn(
                'flex-1 rounded-lg border border-input-card-border bg-bg px-3 py-2 text-[12px] text-text-primary font-mono',
                'placeholder:text-text-muted placeholder:font-sans',
                'focus:border-border-light focus:outline-none transition-colors',
              )}
            />
            <button
              type="button"
              onClick={handleSubmitCode}
              disabled={!pasteValue.trim()}
              className={cn(
                'rounded-md px-3 py-2 text-[12px] font-medium transition-colors',
                pasteValue.trim()
                  ? 'bg-accent text-black hover:bg-accent/90'
                  : 'bg-bg-tertiary text-text-muted cursor-not-allowed border border-input-card-border',
              )}
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {/* ToS warning */}
      {meta.tosWarning && !connected && !isAwaitingCode && !isCodeReceived && (
        <div className="flex items-start gap-2 mx-5 mb-3 rounded-lg border border-warning/25 bg-warning/6 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning mt-0.5" />
          <p className="text-[11px] leading-relaxed text-warning/80">{meta.tosWarning}</p>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="flex items-start gap-2 mx-5 mb-3 rounded-lg border border-error/25 bg-error/6 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-error mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-error/80">{oauthStatus.message}</p>
            <button
              type="button"
              onClick={onSignIn}
              className="mt-1 text-[11px] font-medium text-error hover:text-error/80 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Disconnected reason */}
      {accountInfo?.disconnectedReason && !connected && (
        <div className="mx-5 mb-3">
          <p className="text-[11px] text-warning/80">{accountInfo.disconnectedReason}</p>
        </div>
      )}
    </div>
  )
}

// ─── Main Section ────────────────────────────────────────────────────────────

export function ConnectionsSection(): React.JSX.Element {
  const {
    settings,
    providerModels,
    modelFetchErrors,
    toggleProvider,
    oauthStatuses,
    authAccounts,
    startOAuth,
    submitAuthCode,
    disconnectAuth,
  } = useSettings()

  // Providers that have keys configured or are enabled — shown in the API Keys card
  const configuredProviders = providerModels.filter((p) => {
    const config = settings.providers[p.provider]
    return config?.enabled || (config?.apiKey && config.apiKey.length > 0)
  })

  // Providers that are NOT configured — available to add
  const unconfiguredProviders = providerModels.filter((p) => {
    const config = settings.providers[p.provider]
    return !config?.enabled && (!config?.apiKey || config.apiKey.length === 0)
  })

  const [justAddedProvider, setJustAddedProvider] = useState<Provider | null>(null)

  function handleAddProvider(provider: Provider): void {
    toggleProvider(provider, true)
    setJustAddedProvider(provider)
  }

  return (
    <div className="space-y-6">
      {/* Title + description */}
      <div className="space-y-1">
        <h2 className="text-[20px] font-semibold text-text-primary">Connections</h2>
        <p className="text-[13px] text-text-tertiary">
          Manage API keys and SDK connections for your AI providers.
        </p>
      </div>

      {/* API Keys section */}
      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold text-text-primary">API Keys</h3>

        {configuredProviders.length > 0 && (
          <div className="rounded-lg border border-border bg-[#111418] overflow-hidden">
            {configuredProviders.map((p, i) => (
              <ProviderRow
                key={p.provider}
                providerInfo={p}
                isLast={i === configuredProviders.length - 1}
                autoEdit={justAddedProvider === p.provider}
                onEditingChange={(editing) => {
                  if (!editing && justAddedProvider === p.provider) {
                    setJustAddedProvider(null)
                  }
                }}
                fetchError={modelFetchErrors[p.provider]}
              />
            ))}
          </div>
        )}

        <AddProviderRow availableProviders={unconfiguredProviders} onAdd={handleAddProvider} />
      </div>

      {/* Subscription Connections section */}
      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold text-text-primary">Subscription Connections</h3>
        <p className="text-[12px] text-text-tertiary max-w-[500px]">
          Sign in with your existing provider subscriptions. Toggle to connect or disconnect at any
          time.
        </p>

        <div className="rounded-lg border border-border bg-[#111418] overflow-hidden">
          {SUBSCRIPTION_PROVIDER_ORDER.map((provider, i) => (
            <SubscriptionRow
              key={provider}
              provider={provider}
              accountInfo={authAccounts[provider]}
              oauthStatus={oauthStatuses[provider] ?? { type: 'idle' }}
              onSignIn={() => startOAuth(provider)}
              onDisconnect={() => disconnectAuth(provider)}
              onSubmitCode={(code) => submitAuthCode(provider, code)}
              isLast={i === SUBSCRIPTION_PROVIDER_ORDER.length - 1}
            />
          ))}
        </div>
      </div>

      {/* Footer note */}
      <p className="text-[13px] text-text-tertiary">
        API keys are stored locally on your machine and never sent anywhere except to the respective
        API providers.
      </p>
    </div>
  )
}
