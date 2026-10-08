import type { GitStatusSummary, SourceControlProviderInfo, VcsStatus } from '@shared/types/git'
import type { SessionResource } from '@shared/types/session-resource'
import { getChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import { GitPullRequest } from 'lucide-react'
import { effectiveChangeRequestAttention } from '../model/change-request-attention'
import { ChangeRequestLinkRow, type ChangeRequestOpener } from './ChangeRequestLinkRow'
import {
  SessionSummaryPaginatedList,
  SessionSummaryRow,
  SessionSummarySection,
} from './SessionSummaryPrimitives'
import { SourceControlAttentionNotice } from './SourceControlAttentionNotice'
import type { SourceControlSessionTerminal } from './use-source-control-attention-actions'

type RemoteVcsState = 'loading' | 'loaded' | 'error' | 'unavailable'

function requestCreationDisabledReason(
  gitStatus: GitStatusSummary | null,
  vcsStatus: VcsStatus,
  requestLabel: string,
) {
  if (vcsStatus.refName === null) {
    return `Create or check out a branch before creating a ${requestLabel}.`
  }
  const detailedStatusPending =
    vcsStatus.defaultRef != null &&
    vcsStatus.refName === vcsStatus.defaultRef &&
    vcsStatus.hasWorkingTreeChanges &&
    gitStatus === null
  return detailedStatusPending
    ? `Waiting for local change details before creating a ${requestLabel}.`
    : undefined
}

export function ChangeRequestSummaryRow({
  gitStatus,
  vcsStatus,
  remoteVcsState,
  opener,
  terminal,
  onCreate,
  onRefresh,
  onRecheckSourceControl,
}: {
  readonly gitStatus: GitStatusSummary | null
  readonly vcsStatus: VcsStatus | null
  readonly remoteVcsState: RemoteVcsState
  readonly opener: ChangeRequestOpener
  readonly terminal: SourceControlSessionTerminal | null
  readonly onCreate: () => void
  readonly onRefresh: () => void
  /** Drops the Host's cached source-control answers, then re-reads VCS status. */
  readonly onRecheckSourceControl: () => Promise<void>
}) {
  const provider = vcsStatus?.sourceControlProvider?.id ?? null
  const terminology = getChangeRequestTerminology(provider)
  const existing = vcsStatus?.changeRequest
  if (existing) {
    return (
      <ChangeRequestLinkRow
        label={`View ${terminology.shortLabel}`}
        url={existing.url}
        remote={vcsStatus?.sourceControlProvider ?? null}
        opener={opener}
      />
    )
  }
  const attention = effectiveChangeRequestAttention(vcsStatus ?? null)
  if (attention) {
    return (
      <SourceControlAttentionNotice
        label="Change request setup"
        attention={attention}
        terminal={terminal}
        websiteUrl={vcsStatus?.sourceControlRepositoryUrl ?? null}
        onRecheck={onRecheckSourceControl}
      />
    )
  }
  if (!vcsStatus?.sourceControlProvider) return null
  return (
    <ChangeRequestStatusRow
      gitStatus={gitStatus}
      vcsStatus={vcsStatus}
      remoteVcsState={remoteVcsState}
      onCreate={onCreate}
      onRefresh={onRefresh}
    />
  )
}

/** Create, retry, or still-checking: the row once no request and no attention is known. */
function ChangeRequestStatusRow({
  gitStatus,
  vcsStatus,
  remoteVcsState,
  onCreate,
  onRefresh,
}: {
  readonly gitStatus: GitStatusSummary | null
  readonly vcsStatus: VcsStatus
  readonly remoteVcsState: RemoteVcsState
  readonly onCreate: () => void
  readonly onRefresh: () => void
}) {
  const terminology = getChangeRequestTerminology(vcsStatus.sourceControlProvider?.id)
  if (remoteVcsState === 'loaded') {
    return (
      <SessionSummaryRow
        icon={<GitPullRequest className="size-4" />}
        label={`Create ${terminology.shortLabel}`}
        disabledReason={requestCreationDisabledReason(gitStatus, vcsStatus, terminology.singular)}
        onClick={onCreate}
      />
    )
  }
  if (remoteVcsState === 'error') {
    return (
      <SessionSummaryRow
        icon={<GitPullRequest className="size-4" />}
        label={`Retry ${terminology.shortLabel} status`}
        onClick={onRefresh}
      />
    )
  }
  const checking = remoteVcsState === 'loading'
  return (
    <SessionSummaryRow
      icon={<GitPullRequest className="size-4" />}
      label={
        checking
          ? `Checking ${terminology.shortLabel} status…`
          : `${terminology.shortLabel} status unavailable`
      }
      disabledReason={
        checking
          ? `Checking for an existing ${terminology.singular}.`
          : `Existing ${terminology.singular} status is unavailable.`
      }
      onClick={onRefresh}
    />
  )
}

function normalizedRequestUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/u, '')
  } catch {
    return value
  }
}

export function SessionChangeRequestsSection({
  resources,
  currentUrl,
  remote,
  expanded,
  onExpandedChange,
  opener,
}: {
  readonly resources: readonly SessionResource[]
  readonly currentUrl: string | null
  /** The Session remote's provider and host. */
  readonly remote: SourceControlProviderInfo | null
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
  readonly opener: ChangeRequestOpener
}) {
  const normalizedCurrent = normalizedRequestUrl(currentUrl)
  const requests = [
    ...new Map(
      resources.flatMap((resource) => {
        const locator = resource.locator
        if (resource.kind !== 'change-request' || !resource.isOutput || !locator) return []
        const normalized = normalizedRequestUrl(locator)
        if (!normalized || normalized === normalizedCurrent) return []
        return [[normalized, { resource, locator }] as const]
      }),
    ).values(),
  ]
  if (requests.length === 0) return null
  const terminology = getChangeRequestTerminology(remote?.id)
  const title = `${currentUrl ? 'Other ' : ''}${terminology.plural}`
  return (
    <SessionSummarySection
      id="change-requests"
      title={title.charAt(0).toUpperCase() + title.slice(1)}
      count={requests.length}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    >
      <SessionSummaryPaginatedList
        items={requests}
        getKey={(request) => request.resource.id}
        renderItem={(request) => (
          <ChangeRequestLinkRow
            label={request.resource.title}
            url={request.locator}
            remote={remote}
            opener={opener}
          />
        )}
      />
    </SessionSummarySection>
  )
}
