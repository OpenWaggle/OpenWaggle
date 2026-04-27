import type { OAuthAccountInfo, OAuthFlowStatus } from '@shared/types/auth'
import type { ProviderInfo } from '@shared/types/llm'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'
import { getProviderMeta } from './meta'

interface OAuthProviderRowProps {
  readonly providerInfo: ProviderInfo
  readonly isLast: boolean
}

function resolveOauthStatus(status: OAuthFlowStatus | undefined): OAuthFlowStatus {
  return status ?? { type: 'idle' }
}

function resolveAccountInfo(
  accountInfo: OAuthAccountInfo | null | undefined,
): OAuthAccountInfo | null {
  return accountInfo ?? null
}

export function OAuthProviderRow({ providerInfo, isLast }: OAuthProviderRowProps) {
  const { oauthStatuses, authAccounts, startOAuth, submitAuthCode, cancelOAuth, disconnectAuth } =
    useAuth()
  const provider = providerInfo.provider
  const oauthStatus = resolveOauthStatus(oauthStatuses[provider])
  const accountInfo = resolveAccountInfo(authAccounts[provider])
  const meta = getProviderMeta(provider)
  const Icon = meta.icon
  const connected = accountInfo?.connected ?? providerInfo.auth.oauthConnected
  const isBusy =
    oauthStatus.type === 'in-progress' ||
    oauthStatus.type === 'awaiting-code' ||
    oauthStatus.type === 'code-received'
  const isAwaitingCode = oauthStatus.type === 'awaiting-code'
  const isCodeReceived = oauthStatus.type === 'code-received'
  const isError = oauthStatus.type === 'error'

  const [pasteValue, setPasteValue] = useState('')

  const statusColor = connected ? '#34d399' : '#6b7280'
  const statusText = connected ? 'Connected' : 'Disconnected'
  const toggleActive = connected || isBusy
  const toggleLabel = isBusy
    ? `Cancel ${providerInfo.displayName} sign in`
    : `${connected ? 'Disconnect' : 'Connect'} ${providerInfo.displayName}`

  function handlePrimaryAction(): void {
    if (isBusy) {
      void cancelOAuth(provider)
      return
    }

    if (connected) {
      void disconnectAuth(provider)
      return
    }

    void startOAuth(provider)
  }

  function handleSubmitCode(): void {
    const trimmed = pasteValue.trim()
    if (trimmed) {
      void submitAuthCode(provider, trimmed)
      setPasteValue('')
    }
  }

  return (
    <div className={cn(!isLast && 'border-b border-border')}>
      <div className="flex items-center justify-between min-h-14 gap-4 px-5 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-input-card-border bg-[#151a22]">
            <Icon className="h-4 w-4" style={{ color: meta.color }} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-text-primary">
              {providerInfo.displayName}
            </div>
            {connected && accountInfo?.label && (
              <div className="truncate text-[11px] text-text-tertiary">{accountInfo.label}</div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {isBusy ? (
            <div className="flex h-[22px] items-center gap-1.5 px-2">
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
                  ? 'Completing sign in...'
                  : isAwaitingCode
                    ? 'Waiting for browser...'
                    : 'Opening browser...'}
              </span>
            </div>
          ) : (
            <div className="flex h-[22px] items-center gap-1 rounded-[10px] px-2">
              <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
              <span className="text-[11px] font-medium" style={{ color: statusColor }}>
                {statusText}
              </span>
            </div>
          )}

          <button
            type="button"
            aria-label={toggleLabel}
            onClick={handlePrimaryAction}
            className={cn(
              'relative h-5 w-9 rounded-full transition-colors',
              toggleActive ? 'bg-accent' : 'bg-[#2a2f3a]',
            )}
          >
            <span
              className={cn(
                'absolute top-[3px] h-3.5 w-3.5 rounded-full transition-all',
                toggleActive ? 'left-5 bg-white' : 'left-[2px] bg-text-tertiary',
              )}
            />
          </button>
        </div>
      </div>

      {isAwaitingCode && (
        <div className="mx-5 mb-3 space-y-2">
          <p className="text-[11px] text-text-tertiary">
            Pi is waiting for the browser callback. If it does not finish automatically, paste the
            OAuth code or callback URL here.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmitCode()
              }}
              placeholder="Paste OAuth code or callback URL"
              className={cn(
                'flex-1 rounded-lg border border-input-card-border bg-bg px-3 py-2 font-mono text-[12px] text-text-primary',
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
                  : 'cursor-not-allowed border border-input-card-border bg-bg-tertiary text-text-muted',
              )}
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {isError && (
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg border border-error/25 bg-error/6 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-error" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-error/80">{oauthStatus.message}</p>
            <button
              type="button"
              onClick={() => {
                void startOAuth(provider)
              }}
              className="mt-1 text-[11px] font-medium text-error transition-colors hover:text-error/80"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
