import { match } from '@diegogbrisa/ts-match'
import {
  type SourceControlHostChoice,
  type SourceControlHostEntry,
  sourceControlSignInCommand,
} from '@shared/types/git'
import { useState } from 'react'
import { sessionTerminalShell } from '@/shared/lib/terminal-shell'
import { Button } from '@/shared/ui/Button'
import { CopyableCommand } from '@/shared/ui/CopyableCommand'
import { Select } from '@/shared/ui/Select'
import { SOURCE_CONTROL_HOST_CHOICES } from './source-control-providers'
import { useSourceControlConfigure } from './use-source-control-configure'

/** How the provider was decided, in the user's words. */
function sourceLabel(entry: SourceControlHostEntry) {
  if (entry.unsupported) return 'Not GitHub or GitLab'
  if (entry.source === null) return 'Provider unknown'
  return match(entry.source)
    .with('user-choice', () => 'Chosen by you')
    .with('project-declaration', () => 'Declared by the project')
    .with('public-host', () => 'Public host')
    .with('cli-sign-in', () => `From your ${entry.cli ?? 'CLI'} sign-in`)
    .with('git-credential-helper', () => 'From a git credential helper')
    .with('repository-path', () => 'From the repository path')
    .with('host-name', () => 'From the host name')
    .with('remote-refs', () => 'Detected from the remote')
    .exhaustive()
}

function accountLabel(entry: SourceControlHostEntry) {
  if (entry.cli === null) return null
  if (!entry.cliInstalled) return `${entry.cli} not installed`
  const [first] = entry.accounts
  if (first === undefined) return 'Not signed in'
  if (entry.accounts.length === 1) return `Signed in as @${first.login}`
  return `${String(entry.accounts.length)} accounts`
}

function hostChoice(value: string): SourceControlHostChoice | null {
  return SOURCE_CONTROL_HOST_CHOICES.find((option) => option.id === value)?.id ?? null
}

export function SourceControlHostRow({ entry }: { readonly entry: SourceControlHostEntry }) {
  const { configureOrToast, pending } = useSourceControlConfigure()
  const [showSignIn, setShowSignIn] = useState(false)
  const accounts = accountLabel(entry)
  const provider = entry.provider
  const choice: SourceControlHostChoice | '' = entry.unsupported ? 'unsupported' : (provider ?? '')
  const signedIn = entry.accounts.length > 0
  return (
    <li
      aria-label={entry.host}
      className="space-y-2 border-b border-border px-5 py-3 last:border-b-0"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-text-primary">{entry.host}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-text-tertiary">
            <span>{sourceLabel(entry)}</span>
            {accounts === null ? null : (
              <span title={entry.accounts.map((account) => `@${account.login}`).join(', ')}>
                {accounts}
              </span>
            )}
          </div>
        </div>
        <Select
          selectSize="xs"
          aria-label={`Provider for ${entry.host}`}
          value={choice}
          aria-disabled={pending ? true : undefined}
          onChange={(event) => {
            // aria-disabled keeps keyboard focus here while a change is saving.
            if (pending) return
            const next = hostChoice(event.target.value)
            if (next !== null && next !== choice) {
              configureOrToast({ kind: 'set-host-provider', host: entry.host, provider: next })
            }
          }}
        >
          {choice === '' ? <option value="">Choose…</option> : null}
          {SOURCE_CONTROL_HOST_CHOICES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
        {provider !== null && entry.cliInstalled ? (
          <Button
            variant="ghost"
            size="xs"
            aria-label={signedIn ? `Add account for ${entry.host}` : `Sign in to ${entry.host}`}
            aria-expanded={showSignIn}
            onClick={() => setShowSignIn((open) => !open)}
          >
            {signedIn ? 'Add account' : 'Sign in'}
          </Button>
        ) : null}
        {isForgettable(entry) ? (
          <Button
            variant="ghost"
            size="xs"
            aria-label={`Forget ${entry.host}`}
            aria-disabled={pending ? true : undefined}
            onClick={() => {
              if (!pending) {
                configureOrToast({ kind: 'set-host-provider', host: entry.host, provider: null })
              }
            }}
          >
            Forget
          </Button>
        ) : null}
      </div>
      {showSignIn && provider !== null ? (
        <div className="space-y-1">
          <p className="text-xs text-text-tertiary">Run this in a terminal, then come back.</p>
          <CopyableCommand
            command={sourceControlSignInCommand(provider, entry.host, sessionTerminalShell())}
          />
        </div>
      ) : null}
    </li>
  )
}

/**
 * Forget clears the user's own choice and what OpenWaggle detected. A public host, a CLI sign-in,
 * or a project declaration would decide the same provider again, so Forget is not offered there.
 */
function isForgettable(entry: SourceControlHostEntry) {
  return entry.unsupported || entry.source === 'user-choice' || entry.source === 'remote-refs'
}
