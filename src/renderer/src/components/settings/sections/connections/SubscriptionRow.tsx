import type {
  OAuthFlowStatus,
  SubscriptionAccountInfo,
  SubscriptionProvider,
} from '@shared/types/auth'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { WarningCallout } from '@/components/settings/common/WarningCallout'
import { useAuth } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'
import { SUBSCRIPTION_META } from './meta'

interface SubscriptionRowProps {
  readonly provider: SubscriptionProvider
  readonly isLast: boolean
}

function resolveOauthStatus(status: OAuthFlowStatus | undefined): OAuthFlowStatus {
  return status ?? { type: 'idle' }
}

function resolveAccountInfo(
  accountInfo: SubscriptionAccountInfo | null | undefined,
): SubscriptionAccountInfo | null {
  return accountInfo ?? null
}

export function SubscriptionRow({ provider, isLast }: SubscriptionRowProps) {
  const { oauthStatuses, authAccounts, startOAuth, submitAuthCode, disconnectAuth } = useAuth()
  const oauthStatus = resolveOauthStatus(oauthStatuses[provider])
  const accountInfo = resolveAccountInfo(authAccounts[provider])

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
      disconnectAuth(provider)
    } else {
      startOAuth(provider)
    }
  }

  function handleSubmitCode(): void {
    const trimmed = pasteValue.trim()
    if (trimmed) {
      submitAuthCode(provider, trimmed)
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

      {meta.tosWarning && !connected && !isAwaitingCode && !isCodeReceived && (
        <WarningCallout className="mx-5 mb-3" contentClassName="text-[11px] leading-relaxed">
          <p>{meta.tosWarning}</p>
        </WarningCallout>
      )}

      {isError && (
        <div className="flex items-start gap-2 mx-5 mb-3 rounded-lg border border-error/25 bg-error/6 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-error mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-error/80">{oauthStatus.message}</p>
            <button
              type="button"
              onClick={() => startOAuth(provider)}
              className="mt-1 text-[11px] font-medium text-error hover:text-error/80 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {accountInfo?.disconnectedReason && !connected && (
        <div className="mx-5 mb-3">
          <p className="text-[11px] text-warning/80">{accountInfo.disconnectedReason}</p>
        </div>
      )}
    </div>
  )
}
