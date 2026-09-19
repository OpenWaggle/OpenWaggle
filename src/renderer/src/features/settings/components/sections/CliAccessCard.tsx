import type { CliShimMutationResult, CliShimStatus } from '@shared/types/cli-shim'
import { AlertTriangle, Check, SquareTerminal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'

const logger = createRendererLogger('settings')

function statusLabel(status: CliShimStatus) {
  if (status.management === 'installer') return 'Installed by the app installer'
  if (status.state === 'installed') return 'Installed'
  if (status.state === 'outdated') return 'Update available'
  if (status.state === 'conflict') return 'Path already in use'
  if (status.state === 'unavailable') return 'Unavailable'
  return 'Not installed'
}

function CliStatusIcon({ status }: { readonly status: CliShimStatus }) {
  if (status.state === 'conflict' || (status.state === 'installed' && !status.onPath)) {
    return <AlertTriangle className="size-4 text-warning-text" />
  }
  if (status.state === 'installed') return <Check className="size-4 text-success-text" />
  return <SquareTerminal className="size-4 text-text-tertiary" />
}

function useCliShimManagement() {
  const [status, setStatus] = useState<CliShimStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getCliShimStatus()
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch((cause: unknown) => {
        logger.warn('Failed to read CLI installation status', { error: String(cause) })
        if (!cancelled) setError('Could not read the CLI installation status.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function mutate(action: () => Promise<CliShimMutationResult>) {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      setStatus(result.status)
      if (!result.ok) setError(result.error)
    } catch (cause) {
      logger.warn('Failed to change CLI installation', { error: String(cause) })
      setError('Could not change the CLI installation.')
    } finally {
      setBusy(false)
    }
  }

  return { status, busy, error, mutate }
}

function CliStatusSummary({ status }: { readonly status: CliShimStatus | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {status ? <CliStatusIcon status={status} /> : <SquareTerminal className="size-4" />}
      <div className="min-w-0">
        <p className="text-xs font-medium text-text-primary">
          {status ? statusLabel(status) : 'Checking installation…'}
        </p>
        {status?.commandPath ? (
          <p className="truncate font-mono text-xs text-text-tertiary" title={status.commandPath}>
            {status.commandPath}
          </p>
        ) : status?.detail ? (
          <p className="text-xs text-text-tertiary">{status.detail}</p>
        ) : null}
      </div>
    </div>
  )
}

function CliActions(props: {
  readonly status: CliShimStatus | null
  readonly busy: boolean
  readonly mutate: (action: () => Promise<CliShimMutationResult>) => Promise<void>
}) {
  const { status, busy, mutate } = props

  const canInstall =
    status?.management === 'user-shim' &&
    (status.state === 'not-installed' || status.state === 'outdated')
  const canRemove =
    status?.management === 'user-shim' &&
    (status.state === 'installed' || status.state === 'outdated')

  return (
    <div className="flex shrink-0 items-center gap-2">
      {canRemove ? (
        <Button
          disabled={busy}
          size="xs"
          variant="secondary"
          onClick={() => void mutate(() => api.removeCliShim())}
        >
          Remove
        </Button>
      ) : null}
      {canInstall ? (
        <Button disabled={busy} size="xs" onClick={() => void mutate(() => api.installCliShim())}>
          {status.state === 'outdated' ? 'Update' : 'Install'}
        </Button>
      ) : null}
    </div>
  )
}

function CliStatusNotes({ status }: { readonly status: CliShimStatus | null }) {
  if (status?.management === 'user-shim' && status.state === 'installed' && !status.onPath) {
    return (
      <p className="text-xs text-warning-text">
        Installed, but ~/.local/bin is not in the PATH OpenWaggle received. Add it to your shell
        PATH before using the command.
      </p>
    )
  }
  if (status?.state === 'conflict' && status.detail) {
    return <p className="text-xs text-warning-text">{status.detail}</p>
  }
  return null
}

export function CliAccessCard() {
  const cli = useCliShimManagement()

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-text-primary">OpenWaggle CLI</span>
        <span className="text-xs text-text-tertiary">
          Lets terminals and external agents find, create, message, wait for, and export Sessions.
        </span>
      </div>
      <div className="flex min-h-14 items-center justify-between gap-4 rounded-lg border border-border bg-bg px-5 py-3">
        <CliStatusSummary status={cli.status} />
        <CliActions status={cli.status} busy={cli.busy} mutate={cli.mutate} />
      </div>
      <CliStatusNotes status={cli.status} />
      {cli.error ? (
        <p className="text-xs text-error-text" role="alert">
          {cli.error}
        </p>
      ) : null}
    </div>
  )
}
