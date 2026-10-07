import type { OAuthDeviceCode, OAuthFlowStatus } from '@shared/types/auth'
import { Clipboard } from 'lucide-react'
import { useState } from 'react'
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'

const DEFAULT_CODE_PROMPT = 'Paste OAuth code or callback URL'

function OAuthDeviceCodeCard({ deviceCode }: { readonly deviceCode: OAuthDeviceCode }) {
  return (
    <div className="space-y-1 rounded-lg border border-border-light bg-bg-secondary px-3 py-2">
      <p className="text-xs text-text-tertiary">Enter this code in the browser window:</p>
      <p className="font-mono text-base font-semibold tracking-normal text-text-primary">
        {deviceCode.userCode}
      </p>
      <p className="break-all text-xs text-text-muted">{deviceCode.verificationUri}</p>
    </div>
  )
}

/** The provider's sign-in link, for a browser on another machine (copy-code sign-in). */
function OAuthSignInLink({ authUrl }: { readonly authUrl: string }) {
  const { copied, copy } = useCopyToClipboard()
  return (
    <Button variant="secondary" size="xs" className="text-xs" onClick={() => copy(authUrl)}>
      <Clipboard className="size-3" />
      {copied ? 'Copied' : 'Copy sign-in link'}
    </Button>
  )
}

/** What a sign-in waiting for the user asks for, in the provider's words, and its link. */
export function OAuthManualCodePrompt({
  provider,
  oauthStatus,
  submitAuthCode,
}: {
  readonly provider: string
  readonly oauthStatus: OAuthFlowStatus
  readonly submitAuthCode: (provider: string, code: string) => Promise<void>
}) {
  const [pasteValue, setPasteValue] = useState('')
  const awaiting = oauthStatus.type === 'awaiting-code' ? oauthStatus : undefined
  const deviceCode = awaiting?.deviceCode
  const prompt = awaiting?.prompt
  const authUrl = awaiting?.authUrl
  const instructions = awaiting?.instructions
  const label = prompt?.message ?? DEFAULT_CODE_PROMPT

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
        <OAuthDeviceCodeCard deviceCode={deviceCode} />
      ) : (
        <p className="text-xs text-text-tertiary">
          {instructions ??
            'Waiting for the browser callback. If it does not finish automatically, paste the OAuth code or callback URL here.'}
        </p>
      )}
      {authUrl && <OAuthSignInLink authUrl={authUrl} />}
      <div className="flex items-center gap-2">
        <TextInput
          type={prompt?.secret ? 'password' : 'text'}
          aria-label={label}
          value={pasteValue}
          onChange={(e) => setPasteValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmitCode()
          }}
          placeholder={prompt?.placeholder ?? label}
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
