import type {
  OAuthFlowStatus,
  SubscriptionAccountInfo,
  SubscriptionProvider,
} from '@shared/types/auth'
import { AlertTriangle, Loader2, LogOut } from 'lucide-react'
import { cn } from '@/lib/cn'

const TOS_WARNINGS: Partial<Record<SubscriptionProvider, string>> = {
  openai:
    "Uses OpenAI's Codex authentication flow. This is not officially supported for third-party applications.",
  anthropic:
    "Warning: Anthropic's Terms of Service prohibit using subscription OAuth tokens in third-party applications. This may be blocked or result in account restrictions.",
}

interface SubscriptionAuthButtonProps {
  provider: SubscriptionProvider
  providerDisplayName: string
  accountInfo: SubscriptionAccountInfo | null | undefined
  oauthStatus: OAuthFlowStatus
  onSignIn: () => void
  onDisconnect: () => void
}

export function SubscriptionAuthButton({
  provider,
  providerDisplayName,
  accountInfo,
  oauthStatus,
  onSignIn,
  onDisconnect,
}: SubscriptionAuthButtonProps): React.JSX.Element {
  const isInProgress = oauthStatus.type === 'in-progress'
  const isError = oauthStatus.type === 'error'
  const connected = accountInfo?.connected ?? false
  const tosWarning = TOS_WARNINGS[provider]

  if (connected) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-lg border border-accent/25 bg-accent/6 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-accent" />
            <span className="text-sm text-text-primary">
              Connected via {providerDisplayName} subscription
            </span>
          </div>
          <button
            type="button"
            onClick={onDisconnect}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Disconnect
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {tosWarning && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/6 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning mt-0.5" />
          <p className="text-[12px] leading-relaxed text-warning/80">{tosWarning}</p>
        </div>
      )}

      <button
        type="button"
        onClick={onSignIn}
        disabled={isInProgress}
        className={cn(
          'w-full rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
          isInProgress
            ? 'border-border bg-bg-tertiary text-text-muted cursor-not-allowed'
            : 'border-border bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        )}
      >
        {isInProgress ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Signing in...
          </span>
        ) : (
          `Sign in with ${providerDisplayName}`
        )}
      </button>

      {isError && (
        <div className="flex items-start gap-2 rounded-lg border border-error/25 bg-error/6 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-error mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] text-error/80">{oauthStatus.message}</p>
            <button
              type="button"
              onClick={onSignIn}
              className="mt-1 text-[12px] font-medium text-error hover:text-error/80 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {accountInfo?.disconnectedReason && (
        <p className="text-[12px] text-warning/80">{accountInfo.disconnectedReason}</p>
      )}
    </div>
  )
}
