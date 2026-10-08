import { useQuery } from '@tanstack/react-query'
import { GitBranch } from 'lucide-react'
import { useState } from 'react'
import {
  sourceControlHostsQueryOptions,
  useSourceControlQueryFreshness,
} from '@/queries/source-control'
import { Button } from '@/shared/ui/Button'
import { ChangeRequestOpenDestinationSetting } from './ChangeRequestOpenDestinationSetting'
import { SourceControlAddHostForm } from './SourceControlAddHostForm'
import { SourceControlHostRow } from './SourceControlHostRow'

/** Settings → Connections → Source control: hosts, their providers and accounts, and where requests open. */
export function SourceControlSection() {
  // Signing in happens in a terminal outside Settings, so coming back re-reads the accounts.
  useSourceControlQueryFreshness()
  const hosts = useQuery(sourceControlHostsQueryOptions())
  const [adding, setAdding] = useState(false)
  const entries = hosts.data?.hosts ?? []
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4 p-1">
        <div className="flex min-w-0 items-start gap-2.5">
          <GitBranch className="mt-0.5 size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <h3 className="text-base font-semibold text-text-primary">Source control</h3>
            <p className="max-w-180 text-xs leading-5 text-text-tertiary">
              Pull and merge requests use the gh and glab CLIs and the accounts they hold.
            </p>
          </div>
        </div>
        {adding ? null : (
          <Button variant="secondary" size="xs" onClick={() => setAdding(true)}>
            Add host…
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-bg">
        {hosts.isError ? (
          <p role="alert" className="px-5 py-3 text-xs text-error-text">
            Could not load source control hosts: {hosts.error.message}
          </p>
        ) : null}
        {hosts.isLoading ? (
          <p className="px-5 py-3 text-xs text-text-muted">Loading hosts…</p>
        ) : null}
        {hosts.isSuccess && entries.length === 0 && !adding ? (
          <p className="px-5 py-3 text-xs text-text-muted">No hosts yet.</p>
        ) : null}
        {entries.length > 0 ? (
          <ul aria-label="Source control hosts">
            {entries.map((entry) => (
              <SourceControlHostRow key={entry.host} entry={entry} />
            ))}
          </ul>
        ) : null}
        {adding ? <SourceControlAddHostForm onDone={() => setAdding(false)} /> : null}
      </div>
      <ChangeRequestOpenDestinationSetting />
    </div>
  )
}
