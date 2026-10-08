import { matchBy } from '@diegogbrisa/ts-match'
import type { SourceControlAttention, SourceControlProviderId } from '@shared/types/git'
import { getChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import { CircleAlert, ExternalLink } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '@/shared/ui/Button'
import { formatAlternatives, providerSiteLabel } from '../model/change-request-attention'
import {
  ChoiceButton,
  CliMissingBody,
  NoticeActions,
  type NoticeControls,
  NoticeTitle,
  SignInAction,
} from './SourceControlAttentionParts'
import {
  type SourceControlSessionTerminal,
  useRecheckOnWindowFocus,
  useSourceControlAttentionActions,
} from './use-source-control-attention-actions'

type Kind<K extends SourceControlAttention['kind']> = Extract<SourceControlAttention, { kind: K }>

const HOST_CHOICES = [
  ['github', 'GitHub'],
  ['gitlab', 'GitLab'],
  ['unsupported', 'Neither'],
] as const

const DECLARATION_DECISIONS = [
  ['approved', 'Allow'],
  ['declined', 'Ignore'],
] as const

function providerName(provider: SourceControlProviderId) {
  return getChangeRequestTerminology(provider).providerName
}

function attentionProvider(attention: SourceControlAttention) {
  if (attention.kind === 'choose-provider') return null
  if (attention.kind === 'approve-declaration') return Object.values(attention.hosts)[0] ?? null
  return attention.provider
}

function declarationSummary(hosts: Kind<'approve-declaration'>['hosts']) {
  return Object.entries(hosts)
    .map(([host, provider]) => `${host} is ${providerName(provider)}`)
    .join(', ')
}

function AttentionBody({
  attention,
  controls,
}: {
  readonly attention: SourceControlAttention
  readonly controls: NoticeControls
}) {
  return matchBy(attention, 'kind')
    .with('choose-provider', (current) => (
      <>
        <NoticeTitle>Is {current.host} GitHub or GitLab?</NoticeTitle>
        <NoticeActions>
          {HOST_CHOICES.map(([provider, label]) => (
            <ChoiceButton
              key={provider}
              label={label}
              controls={controls}
              request={{ kind: 'set-host-provider', host: current.host, provider }}
            />
          ))}
        </NoticeActions>
      </>
    ))
    .with('approve-declaration', (current) => (
      <>
        <NoticeTitle>This project says {declarationSummary(current.hosts)}.</NoticeTitle>
        <NoticeActions>
          {DECLARATION_DECISIONS.map(([decision, label]) => (
            <ChoiceButton
              key={decision}
              label={label}
              controls={controls}
              request={{
                kind: 'decide-project-declaration',
                projectPath: current.projectPath,
                decision,
                hosts: current.hosts,
              }}
            />
          ))}
        </NoticeActions>
      </>
    ))
    .with('cli-missing', (current) => <CliMissingBody attention={current} controls={controls} />)
    .with('not-signed-in', (current) => (
      <>
        <NoticeTitle>Not signed in to {current.host}</NoticeTitle>
        {current.ignoredTokenVariables.length > 0 ? (
          <p className="text-xs text-text-tertiary">
            OpenWaggle uses {current.cli}'s stored sign-in, not{' '}
            {formatAlternatives(current.ignoredTokenVariables)}.
          </p>
        ) : null}
        <SignInAction
          label={`Sign in to ${current.host}`}
          attention={current}
          controls={controls}
        />
      </>
    ))
    .with('no-account-access', (current) => (
      <>
        <NoticeTitle>
          None of your {providerName(current.provider)} accounts can see {current.repository}
        </NoticeTitle>
        {current.accounts.length > 0 ? (
          <p className="text-xs text-text-secondary">
            Tried {formatAlternatives(current.accounts.map((login) => `@${login}`))}.
          </p>
        ) : null}
        <SignInAction
          label="Sign in with another account"
          attention={current}
          controls={controls}
        />
      </>
    ))
    .exhaustive()
}

function needsFocusRecheck(attention: SourceControlAttention) {
  return (
    attention.kind === 'cli-missing' ||
    attention.kind === 'not-signed-in' ||
    attention.kind === 'no-account-access'
  )
}

function statusText(controls: NoticeControls) {
  if (controls.checking) return 'Checking…'
  if (controls.signingIn) return 'Finish signing in in the terminal.'
  return ''
}

/**
 * Why change requests cannot load, the one fix, and the provider site as a way out. Shared by
 * the Session Summary's Change request row and the Change request inspector; `label` names the
 * landmark so each surface's notice is distinct.
 */
export function SourceControlAttentionNotice({
  label,
  attention,
  terminal,
  websiteUrl,
  onRecheck,
}: {
  readonly label: string
  readonly attention: SourceControlAttention
  readonly terminal: SourceControlSessionTerminal | null
  readonly websiteUrl: string | null
  readonly onRecheck: () => Promise<void> | void
}) {
  const regionRef = useRef<HTMLElement>(null)
  const actions = useSourceControlAttentionActions({ terminal, onRecheck })
  const controls: NoticeControls = {
    ...actions,
    choose: (request) => {
      void actions.configure(request).then((saved) => {
        // The choice buttons go away once the answer lands; keep focus on the notice itself.
        if (saved) regionRef.current?.focus()
      })
    },
  }
  useRecheckOnWindowFocus(needsFocusRecheck(attention), actions.recheck)
  const status = statusText(controls)
  return (
    <section
      ref={regionRef}
      tabIndex={-1}
      aria-label={label}
      className="flex gap-2 rounded-md border border-border bg-bg px-2 py-2 focus:outline-none"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <AttentionBody attention={attention} controls={controls} />
        {actions.error ? (
          <p role="alert" className="text-xs text-error-text">
            {actions.error}
          </p>
        ) : null}
        <output
          aria-live="polite"
          className={status ? 'block text-xs text-text-tertiary' : 'sr-only'}
        >
          {status}
        </output>
        {websiteUrl ? (
          <Button
            variant="link"
            size="none"
            className="text-xs"
            rightIcon={<ExternalLink className="size-3" aria-hidden="true" />}
            onClick={() => actions.openWebsite(websiteUrl)}
          >
            {providerSiteLabel(attentionProvider(attention), websiteUrl)}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
