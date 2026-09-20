import type { GitStatusSummary, SourceControlProviderId, VcsStatus } from '@shared/types/git'
import type { SessionResource } from '@shared/types/session-resource'
import { getChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import { GitPullRequest } from 'lucide-react'
import {
  SessionSummaryPaginatedList,
  SessionSummaryRow,
  SessionSummarySection,
} from './SessionSummaryPrimitives'

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
  onCreate,
  onView,
  onRefresh,
}: {
  readonly gitStatus: GitStatusSummary | null
  readonly vcsStatus: VcsStatus | null
  readonly remoteVcsState: RemoteVcsState
  readonly onCreate: () => void
  readonly onView: (url: string) => void
  readonly onRefresh: () => void
}) {
  const terminology = getChangeRequestTerminology(vcsStatus?.sourceControlProvider?.id)
  const existing = vcsStatus?.changeRequest
  if (existing) {
    return (
      <SessionSummaryRow
        icon={<GitPullRequest className="size-4" />}
        label={`View ${terminology.shortLabel}`}
        onClick={() => onView(existing.url)}
      />
    )
  }
  if (!vcsStatus?.sourceControlProvider) return null
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
  provider,
  expanded,
  onExpandedChange,
  onOpen,
}: {
  readonly resources: readonly SessionResource[]
  readonly currentUrl: string | null
  readonly provider: SourceControlProviderId | null
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
  readonly onOpen: (url: string) => void
}) {
  const normalizedCurrent = normalizedRequestUrl(currentUrl)
  const requests = [
    ...new Map(
      resources.flatMap((resource) => {
        if (resource.kind !== 'change-request' || !resource.isOutput || !resource.locator) return []
        const normalized = normalizedRequestUrl(resource.locator)
        if (!normalized || normalized === normalizedCurrent) return []
        return [[normalized, resource] as const]
      }),
    ).values(),
  ]
  if (requests.length === 0) return null
  const terminology = getChangeRequestTerminology(provider)
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
        getKey={(resource) => resource.id}
        renderItem={(resource) => (
          <SessionSummaryRow
            icon={<GitPullRequest className="size-4" />}
            label={resource.title}
            onClick={() => resource.locator && onOpen(resource.locator)}
          />
        )}
      />
    </SessionSummarySection>
  )
}
