import type { OAuthAccountInfo, OAuthFlowStatus } from '@shared/types/auth'
import type { ProviderInfo } from '@shared/types/llm'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/features/settings/hooks/useSettings'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import { getProviderMeta } from './meta'

interface OAuthProviderRowProps {
  readonly providerInfo: ProviderInfo
  readonly isLast: boolean
}

function resolveOauthStatus(status: OAuthFlowStatus | undefined) {
  return status ?? { type: 'idle' }
}

function resolveAccountInfo(accountInfo: OAuthAccountInfo | null | undefined) {
  return accountInfo ?? null
}

interface OAuthRowState {
  readonly connected: boolean
  readonly isBusy: boolean
  readonly isAwaitingCode: boolean
  readonly isAwaitingSelection: boolean
  readonly isCodeReceived: boolean
  readonly isError: boolean
  readonly statusClassName: string
  readonly statusText: string
  readonly toggleActive: boolean
  readonly toggleLabel: string
}

function resolveOAuthRowState(input: {
  readonly providerInfo: ProviderInfo
  readonly oauthStatus: OAuthFlowStatus
  readonly accountInfo: OAuthAccountInfo | null
}) {
  const connected = input.accountInfo?.connected ?? input.providerInfo.auth.oauthConnected
  const isBusy =
    input.oauthStatus.type === 'in-progress' ||
    input.oauthStatus.type === 'awaiting-code' ||
    input.oauthStatus.type === 'awaiting-selection' ||
    input.oauthStatus.type === 'code-received'

  return {
    connected,
    isBusy,
    isAwaitingCode: input.oauthStatus.type === 'awaiting-code',
    isAwaitingSelection: input.oauthStatus.type === 'awaiting-selection',
    isCodeReceived: input.oauthStatus.type === 'code-received',
    isError: input.oauthStatus.type === 'error',
    statusClassName: connected ? 'text-success' : 'text-neutral',
    statusText: connected ? 'Connected' : 'Disconnected',
    toggleActive: connected || isBusy,
    toggleLabel: isBusy
      ? `Cancel ${input.providerInfo.displayName} sign in`
      : `${connected ? 'Disconnect' : 'Connect'} ${input.providerInfo.displayName}`,
  }
}

function OAuthProviderIdentity({
  providerInfo,
  accountInfo,
  connected,
}: {
  readonly providerInfo: ProviderInfo
  readonly accountInfo: OAuthAccountInfo | null
  readonly connected: boolean
}) {
  const meta = getProviderMeta(providerInfo.provider)
  const Icon = meta.icon

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border-light bg-bg">
        <Icon className={cn('size-4', meta.iconClassName)} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-text-primary">
          {providerInfo.displayName}
        </div>
        {connected && accountInfo?.label && (
          <div className="truncate text-xs text-text-tertiary">{accountInfo.label}</div>
        )}
      </div>
    </div>
  )
}

function OAuthStatusIndicator({ rowState }: { readonly rowState: OAuthRowState }) {
  if (rowState.isBusy) {
    return (
      <div className="flex h-5.5 items-center gap-1.5 px-2">
        {rowState.isCodeReceived ? (
          <Check className="size-3 text-success" />
        ) : (
          <Loader2 className="size-3 animate-spin text-accent" />
        )}
        <span
          className={cn(
            'text-xs font-medium',
            rowState.isCodeReceived ? 'text-success' : 'text-accent',
          )}
        >
          {rowState.isCodeReceived
            ? 'Completing sign in...'
            : rowState.isAwaitingSelection
              ? 'Choose sign-in method...'
              : rowState.isAwaitingCode
                ? 'Waiting for browser...'
                : 'Opening browser...'}
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-5.5 items-center gap-1 rounded-xl px-2">
      <div
        className={cn('size-1.5 rounded-full', rowState.connected ? 'bg-success' : 'bg-neutral')}
      />
      <span className={cn('text-xs font-medium', rowState.statusClassName)}>
        {rowState.statusText}
      </span>
    </div>
  )
}

function OAuthManualCodePrompt({
  provider,
  oauthStatus,
  submitAuthCode,
}: {
  readonly provider: string
  readonly oauthStatus: OAuthFlowStatus
  readonly submitAuthCode: (provider: string, code: string) => Promise<void>
}) {
  const [pasteValue, setPasteValue] = useState('')
  const deviceCode = oauthStatus.type === 'awaiting-code' ? oauthStatus.deviceCode : undefined

  function handleSubmitCode() {
    const trimmed = pasteValue.trim()
    if (trimmed) {
      void submitAuthCode(provider, trimmed)
      setPasteValue('')
    }
  }

  return (
    <div className="mx-5 mb-3 space-y-2">
      {deviceCode ? (
        <div className="space-y-1 rounded-lg border border-border-light bg-bg-secondary px-3 py-2">
          <p className="text-xs text-text-tertiary">Enter this code in the browser window:</p>
          <p className="font-mono text-base font-semibold tracking-normal text-text-primary">
            {deviceCode.userCode}
          </p>
          <p className="break-all text-xs text-text-muted">{deviceCode.verificationUri}</p>
        </div>
      ) : (
        <p className="text-xs text-text-tertiary">
          Waiting for the browser callback. If it does not finish automatically, paste the OAuth
          code or callback URL here.
        </p>
      )}
      <div className="flex items-center gap-2">
        <TextInput
          type="text"
          value={pasteValue}
          onChange={(e) => setPasteValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmitCode()
          }}
          placeholder="Paste OAuth code or callback URL"
          monospace
          className="flex-1 rounded-lg border-border-light text-xs placeholder:text-text-muted focus:border-border-light"
        />
        <Button
          variant="primary"
          size="md"
          onClick={handleSubmitCode}
          disabled={!pasteValue.trim()}
          className="text-xs"
        >
          Connect
        </Button>
      </div>
    </div>
  )
}

function OAuthSelectionPrompt({
  provider,
  oauthStatus,
  submitAuthCode,
}: {
  readonly provider: string
  readonly oauthStatus: OAuthFlowStatus
  readonly submitAuthCode: (provider: string, code: string) => Promise<void>
}) {
  if (oauthStatus.type !== 'awaiting-selection') return null

  return (
    <div className="mx-5 mb-3 space-y-2 rounded-lg border border-border-light bg-bg-secondary px-3 py-2">
      <p className="text-xs text-text-tertiary">{oauthStatus.selection.message}</p>
      <div className="flex flex-wrap items-center gap-2">
        {oauthStatus.selection.options.map((option) => (
          <Button
            key={option.id}
            variant="secondary"
            size="md"
            type="button"
            onClick={() => {
              void submitAuthCode(provider, option.id)
            }}
            className="text-xs"
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

function OAuthErrorMessage({
  provider,
  message,
  startOAuth,
}: {
  readonly provider: string
  readonly message: string
  readonly startOAuth: (provider: string) => Promise<void>
}) {
  return (
    <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg border border-error/25 bg-error/6 px-3 py-2">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-error" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-error-text/80">{message}</p>
        <Button
          variant="unstyled"
          type="button"
          onClick={() => {
            void startOAuth(provider)
          }}
          className="mt-1 text-xs font-medium text-error-text transition-colors hover:text-error-text/80"
        >
          Try again
        </Button>
      </div>
    </div>
  )
}

export function OAuthProviderRow({ providerInfo, isLast }: OAuthProviderRowProps) {
  const { oauthStatuses, authAccounts, startOAuth, submitAuthCode, cancelOAuth, disconnectAuth } =
    useAuth()
  const provider = providerInfo.provider
  const oauthStatus = resolveOauthStatus(oauthStatuses[provider])
  const accountInfo = resolveAccountInfo(authAccounts[provider])
  const rowState = resolveOAuthRowState({ providerInfo, oauthStatus, accountInfo })

  function handlePrimaryAction() {
    if (rowState.isBusy) {
      void cancelOAuth(provider)
      return
    }

    if (rowState.connected) {
      void disconnectAuth(provider)
      return
    }

    void startOAuth(provider)
  }

  return (
    <div className={cn(!isLast && 'border-b border-border')}>
      <div className="flex items-center justify-between min-h-14 gap-4 px-5 py-2">
        <OAuthProviderIdentity
          providerInfo={providerInfo}
          accountInfo={accountInfo}
          connected={rowState.connected}
        />

        <div className="flex shrink-0 items-center gap-3">
          <OAuthStatusIndicator rowState={rowState} />

          <ToggleSwitch
            checked={rowState.toggleActive}
            label={rowState.toggleLabel}
            onCheckedChange={handlePrimaryAction}
          />
        </div>
      </div>

      {rowState.isAwaitingCode && (
        <OAuthManualCodePrompt
          provider={provider}
          oauthStatus={oauthStatus}
          submitAuthCode={submitAuthCode}
        />
      )}

      {rowState.isAwaitingSelection && (
        <OAuthSelectionPrompt
          provider={provider}
          oauthStatus={oauthStatus}
          submitAuthCode={submitAuthCode}
        />
      )}

      {rowState.isError && oauthStatus.type === 'error' && (
        <OAuthErrorMessage
          provider={provider}
          message={oauthStatus.message}
          startOAuth={startOAuth}
        />
      )}
    </div>
  )
}
