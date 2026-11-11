import { match } from '@diegogbrisa/ts-match'
import type { ElectronMigrationNotice as Notice } from '@shared/types/electron-migration'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { api } from '@/shared/lib/ipc'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'
import { Button } from '@/shared/ui/Button'

const NOTICE_QUERY_KEY = ['electron-migration', 'notice'] as const

const noticeQueryOptions = queryOptions({
  queryKey: NOTICE_QUERY_KEY,
  queryFn: () => api.getElectronMigrationNotice(),
  staleTime: Number.POSITIVE_INFINITY,
})

const CONSENT_MESSAGE =
  'OpenWaggle needs the key your previous version kept in your keychain to move your saved MCP secrets and sign-ins. macOS will ask once; choose Always Allow.'
const BLOCKED_MESSAGE =
  'Your saved MCP secrets and sign-ins were not moved from the previous version: the keychain did not answer. Unlock it, then try again.'
const FAILED_MESSAGE =
  'Your saved MCP secrets and sign-ins could not be moved from the previous version.'

function noticeMessage(notice: Notice) {
  return match(notice.secrets)
    .with('needs-consent', () => CONSENT_MESSAGE)
    .with('blocked', () => BLOCKED_MESSAGE)
    .with('failed', () => FAILED_MESSAGE)
    .with(
      'unrecoverable',
      () =>
        `These saved secrets could not be moved from the previous version: ${notice.unrecoverable.join(', ')}. Enter them again.`,
    )
    .exhaustive()
}

function useElectronMigrationNotice() {
  const queryClient = useQueryClient()
  const notice = useQuery(noticeQueryOptions)
  const settle = (next: Notice | null) => queryClient.setQueryData(NOTICE_QUERY_KEY, next)
  const proceed = useMutation({
    mutationFn: () => api.continueElectronSecretsMigration(),
    onSuccess: settle,
  })
  const skip = useMutation({
    mutationFn: () => api.skipElectronSecretsMigration(),
    onSuccess: settle,
  })
  const failure = proceed.error ?? skip.error
  return {
    notice: notice.data ?? null,
    pending: proceed.isPending || skip.isPending,
    failure: failure ? ipcErrorMessage(failure) : null,
    proceed: () => proceed.mutate(),
    skip: () => skip.mutate(),
  }
}

interface ElectronMigrationNoticeProps {
  /** Settings has no app header and its own title bar under the window controls. */
  readonly placement: 'top' | 'bottom'
}

/**
 * What the first launch after the Electron build could not move on its own: the saved secrets,
 * whose key the previous version kept in the keychain (docs/electrobun-transition.md). Nothing
 * reads the keychain until the user chooses Continue; Skip means they enter the secrets again.
 */
export function ElectronMigrationNotice({ placement }: ElectronMigrationNoticeProps) {
  const { notice, pending, failure, proceed, skip } = useElectronMigrationNotice()
  if (!notice) return null
  const consent = notice.secrets === 'needs-consent'
  const busy = pending || notice.busy

  return (
    <section
      aria-label="Moving saved secrets from the previous version"
      className={cn(
        'flex shrink-0 items-start gap-3 border-warning/30 bg-warning/8 px-4 py-2.5 text-sm text-text-secondary',
        placement === 'top' ? 'border-b' : 'border-t',
      )}
    >
      <KeyRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p aria-live="polite" className="break-words">
          {noticeMessage(notice)}
        </p>
        {notice.error && !consent ? <p className="break-words text-xs">{notice.error}</p> : null}
        {failure ? (
          <p role="alert" className="break-words font-medium text-error-text">
            {failure}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {notice.secrets === 'unrecoverable' ? null : (
            <Button
              variant="primary"
              size="xs"
              radius="md"
              aria-disabled={busy}
              aria-busy={busy}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onClick={() => {
                if (!busy) proceed()
              }}
            >
              {consent ? 'Continue' : 'Try again'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            radius="md"
            aria-disabled={busy}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => {
              if (!busy) skip()
            }}
          >
            {notice.secrets === 'unrecoverable' ? 'Dismiss' : "Skip, I'll enter them again"}
          </Button>
        </div>
      </div>
    </section>
  )
}
