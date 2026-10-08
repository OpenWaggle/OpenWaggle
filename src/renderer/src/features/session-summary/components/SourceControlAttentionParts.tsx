import {
  type SourceControlAttention,
  type SourceControlCli,
  type SourceControlConfigureRequest,
  type SourceControlProviderId,
  sourceControlSignInCommand,
} from '@shared/types/git'
import { getChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import type { ReactNode } from 'react'
import { sessionTerminalShell } from '@/shared/lib/terminal-shell'
import { Button } from '@/shared/ui/Button'
import { CopyableCommand } from '@/shared/ui/CopyableCommand'
import {
  SOURCE_CONTROL_CLI_INSTALL_GUIDES,
  sourceControlCliInstallCommand,
} from '../model/change-request-attention'
import type { SourceControlAttentionActions } from './use-source-control-attention-actions'

type Kind<K extends SourceControlAttention['kind']> = Extract<SourceControlAttention, { kind: K }>

export interface NoticeControls extends SourceControlAttentionActions {
  /** Saves a configuration change and, once saved, keeps focus inside the notice. */
  readonly choose: (request: SourceControlConfigureRequest) => void
}

export function NoticeActions({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5">{children}</div>
}

export function NoticeTitle({ children }: { readonly children: ReactNode }) {
  return <p className="text-sm text-text-primary">{children}</p>
}

export function SignInAction({
  label,
  attention,
  controls,
}: {
  readonly label: string
  readonly attention: { readonly provider: SourceControlProviderId; readonly host: string }
  readonly controls: NoticeControls
}) {
  if (!controls.canSignIn) {
    return (
      <CopyableCommand
        command={sourceControlSignInCommand(
          attention.provider,
          attention.host,
          sessionTerminalShell(),
        )}
      />
    )
  }
  return (
    <NoticeActions>
      <Button
        variant="secondary"
        size="xs"
        aria-disabled={controls.signingIn ? true : undefined}
        className="aria-disabled:cursor-progress aria-disabled:opacity-60"
        onClick={() => controls.startSignIn(attention.provider, attention.host)}
      >
        {label}
      </Button>
    </NoticeActions>
  )
}

export function InstallGuideAction({
  cli,
  controls,
}: {
  readonly cli: SourceControlCli
  readonly controls: NoticeControls
}) {
  return (
    <NoticeActions>
      <Button
        variant="link"
        size="none"
        className="text-xs"
        onClick={() => controls.openWebsite(SOURCE_CONTROL_CLI_INSTALL_GUIDES[cli])}
      >
        Install guide
      </Button>
    </NoticeActions>
  )
}

export function CliMissingBody({
  attention,
  controls,
}: {
  readonly attention: Kind<'cli-missing'>
  readonly controls: NoticeControls
}) {
  const command = sourceControlCliInstallCommand(attention.cli)
  return (
    <>
      <NoticeTitle>
        Install {attention.cli} to see {getChangeRequestTerminology(attention.provider).plural}
      </NoticeTitle>
      {command === null ? (
        <p className="text-xs text-text-tertiary">
          Install {attention.cli} with your distribution's package manager.
        </p>
      ) : (
        <CopyableCommand command={command} />
      )}
      <InstallGuideAction cli={attention.cli} controls={controls} />
    </>
  )
}

export function ChoiceButton({
  label,
  controls,
  request,
}: {
  readonly label: string
  readonly controls: NoticeControls
  readonly request: SourceControlConfigureRequest
}) {
  return (
    <Button
      variant="secondary"
      size="xs"
      aria-disabled={controls.saving ? true : undefined}
      onClick={() => {
        if (!controls.saving) controls.choose(request)
      }}
    >
      {label}
    </Button>
  )
}
