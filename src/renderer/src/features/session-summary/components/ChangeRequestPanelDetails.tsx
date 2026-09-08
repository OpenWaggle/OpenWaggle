import type { ChangeRequestCheckStatus, VcsChangeRequestDetails } from '@shared/types/git'
import { CheckCircle2, CircleDot, XCircle } from 'lucide-react'
import { Button } from '@/shared/ui/Button'

const CHECK_TONE: Record<ChangeRequestCheckStatus, string> = {
  passed: 'text-success',
  failed: 'text-error',
  pending: 'text-warning',
  skipped: 'text-text-tertiary',
  cancelled: 'text-text-tertiary',
  unknown: 'text-text-tertiary',
}

function statusIcon(status: ChangeRequestCheckStatus) {
  if (status === 'passed') return <CheckCircle2 className="size-3.5" aria-hidden="true" />
  if (status === 'failed' || status === 'cancelled') {
    return <XCircle className="size-3.5" aria-hidden="true" />
  }
  return <CircleDot className="size-3.5" aria-hidden="true" />
}

export function requestMetric(value: number | null, fallback = '—') {
  return value === null ? fallback : value.toLocaleString()
}

export function ChangeRequestDetailSummary({
  details,
}: {
  readonly details: VcsChangeRequestDetails
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-b border-border px-4 py-3 text-xs">
      <div>
        <dt className="text-text-tertiary">Status</dt>
        <dd className="mt-0.5 capitalize text-text-primary">{details.state}</dd>
      </div>
      <div>
        <dt className="text-text-tertiary">Author</dt>
        <dd className="mt-0.5 truncate text-text-primary">{details.author ?? 'Unknown'}</dd>
      </div>
      <div>
        <dt className="text-text-tertiary">Review</dt>
        <dd className="mt-0.5 capitalize text-text-primary">
          {details.reviewDecision.replaceAll('-', ' ')}
        </dd>
      </div>
      <div>
        <dt className="text-text-tertiary">Mergeability</dt>
        <dd className="mt-0.5 capitalize text-text-primary">{details.mergeability}</dd>
      </div>
      <div className="col-span-2">
        <dt className="text-text-tertiary">Branches</dt>
        <dd className="mt-0.5 truncate font-mono text-xs text-text-primary">
          {details.headRef} → {details.baseRef}
        </dd>
      </div>
    </dl>
  )
}

export function ChangeRequestChecks({ details }: { readonly details: VcsChangeRequestDetails }) {
  return (
    <section className="border-b border-border px-4 py-3" aria-labelledby="request-checks-heading">
      <h3 id="request-checks-heading" className="mb-2 text-xs font-semibold text-text-secondary">
        Checks · {details.checks.length}
      </h3>
      {details.checks.length === 0 ? (
        <p className="text-xs text-text-tertiary">No checks reported.</p>
      ) : (
        <ul className="space-y-1.5">
          {details.checks.map((check) => (
            <li
              key={`${check.name}:${check.url ?? ''}`}
              className="flex min-w-0 items-center gap-2 text-xs"
            >
              <span className={CHECK_TONE[check.status]}>{statusIcon(check.status)}</span>
              <span className="min-w-0 flex-1 truncate text-text-secondary">{check.name}</span>
              <span className="capitalize text-text-tertiary">{check.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function ChangeRequestChangedFiles({
  details,
  currentRef,
  onOpenDiff,
}: {
  readonly details: VcsChangeRequestDetails
  readonly currentRef: string | null
  readonly onOpenDiff: () => void
}) {
  const diffAvailable = currentRef === details.headRef
  const diffReason = diffAvailable
    ? undefined
    : `Check out ${details.headRef} to view its branch diff in this Session.`
  return (
    <section className="border-b border-border px-4 py-3" aria-labelledby="request-files-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="request-files-heading" className="text-xs font-semibold text-text-secondary">
          Changed files · {requestMetric(details.changedFiles)}
        </h3>
        <Button
          variant="ghost"
          size="xs"
          disabled={!diffAvailable}
          title={diffReason}
          onClick={onOpenDiff}
        >
          View branch diff
        </Button>
      </div>
      <p className="mb-2 text-xs text-text-tertiary">
        <span className="text-success">+{requestMetric(details.additions, '0')}</span>{' '}
        <span className="text-error">-{requestMetric(details.deletions, '0')}</span>
      </p>
      {details.files.length > 0 ? (
        <ul className="max-h-40 space-y-1 overflow-y-auto overscroll-contain">
          {details.files.map((file) => (
            <li key={file.path} className="flex min-w-0 items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-mono text-text-secondary">
                {file.path}
              </span>
              <span className="shrink-0 text-success">+{file.additions}</span>
              <span className="shrink-0 text-error">-{file.deletions}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
