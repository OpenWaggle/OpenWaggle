import type { OAuthDeviceCode, OAuthFlowStatus, OAuthInputPrompt } from '@shared/types/auth'
import { Clipboard } from 'lucide-react'
import { useId, useState } from 'react'
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'

type OAuthAwaitingStatus = Extract<OAuthFlowStatus, { readonly type: 'awaiting-code' }>

const BROWSER_HINT = 'Waiting for the browser to finish signing in.'

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

/** The device code to enter, or what the sign-in says to do while it waits. */
function OAuthAwaitingGuidance({ awaiting }: { readonly awaiting: OAuthAwaitingStatus }) {
  if (awaiting.deviceCode) return <OAuthDeviceCodeCard deviceCode={awaiting.deviceCode} />
  // The callback hint only applies while the browser sign-in runs and nothing else is asked.
  const hint =
    awaiting.instructions ?? (awaiting.authUrl && !awaiting.prompt ? BROWSER_HINT : undefined)
  return hint ? <p className="text-xs text-text-tertiary">{hint}</p> : null
}

/** The answer field, labelled with the question the provider asked. */
function OAuthAnswerField({
  prompt,
  onSubmit,
}: {
  readonly prompt: OAuthInputPrompt
  readonly onSubmit: (answer: string) => void
}) {
  const [value, setValue] = useState('')
  const inputId = useId()
  // A text question may be answered with nothing; a code or secret may not.
  const canSubmit = value.trim().length > 0 || prompt.allowEmpty === true

  function submit() {
    if (!canSubmit) return
    onSubmit(value.trim())
    setValue('')
  }

  return (
    <>
      <label htmlFor={inputId} className="block text-xs font-medium text-text-secondary">
        {prompt.message}
      </label>
      <div className="flex items-center gap-2">
        <TextInput
          id={inputId}
          type={prompt.secret ? 'password' : 'text'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder={prompt.placeholder}
          monospace
          className="flex-1 rounded-lg border-border-light text-xs placeholder:text-text-muted focus:border-border-light"
        />
        <Button
          variant="primary"
          size="md"
          onClick={submit}
          disabled={!canSubmit}
          className="text-xs"
        >
          Connect
        </Button>
      </div>
    </>
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
  const awaiting = oauthStatus.type === 'awaiting-code' ? oauthStatus : undefined
  return (
    <div className="mx-5 mb-3 space-y-2">
      {awaiting && <OAuthAwaitingGuidance awaiting={awaiting} />}
      {awaiting?.authUrl && <OAuthSignInLink authUrl={awaiting.authUrl} />}
      {/* Only a question has an answer to send; a sign-in that finishes in the browser has none. */}
      {awaiting?.prompt && (
        <OAuthAnswerField
          prompt={awaiting.prompt}
          onSubmit={(answer) => {
            void submitAuthCode(provider, answer)
          }}
        />
      )}
    </div>
  )
}
