import type { GitBranchInfo, GitStatusSummary, VcsStatus } from '@shared/types/git'
import type { SessionResource } from '@shared/types/session-resource'
import { ChevronRight, FileOutput, FolderOpen, GitCommit, Images } from 'lucide-react'
import type { SessionResourceBrowserTarget } from '../model/session-resource-browser'
import { isViewableSessionImage } from '../model/session-resource-viewability'
import type { SessionSummaryGitAction } from '../model/session-summary-git-action'
import { ChangeRequestSummaryRow } from './SessionChangeRequestSections'
import { SessionSourceAddMenu } from './SessionSourceAddMenu'
import {
  SessionBranchRow,
  SessionEnvironmentActions,
  SessionEnvironmentRow,
} from './SessionSummaryEnvironmentRows'
import {
  SessionSummaryPaginatedList,
  SessionSummaryRow,
  SessionSummarySection,
} from './SessionSummaryPrimitives'

const SUMMARY_RESOURCE_LIMIT = 3

export { SessionChangeRequestsSection } from './SessionChangeRequestSections'

interface EnvironmentSummarySectionInput {
  readonly expanded: boolean
  readonly environmentMode: 'local' | 'worktree'
  readonly workingPath: string | null
  readonly gitStatus: GitStatusSummary | null
  readonly vcsStatus: VcsStatus | null
  readonly remoteVcsState: 'loading' | 'loaded' | 'error' | 'unavailable'
  readonly localVcsState: 'loading' | 'loaded' | 'error' | 'unavailable'
  readonly branches: readonly GitBranchInfo[]
  readonly branchBusy: boolean
  readonly branchError: string | null
  readonly onExpandedChange: (expanded: boolean) => void
  readonly onOpenDiff: () => void
  readonly onCreateChangeRequest: () => void
  readonly onViewChangeRequest: (url: string) => void
  readonly onToggleTerminal: () => void
  readonly onRefreshBranches: () => void
  readonly onRefreshVcsStatus: () => void
  readonly onSelectBranch: (branch: string) => Promise<boolean>
  readonly onCreateBranch: (branch: string) => Promise<boolean>
  readonly quickAction: SessionSummaryGitAction
  readonly onQuickAction: () => void
}

export function EnvironmentSummarySection({
  input,
}: {
  readonly input: EnvironmentSummarySectionInput
}) {
  const {
    expanded,
    environmentMode,
    workingPath,
    gitStatus,
    vcsStatus,
    remoteVcsState,
    localVcsState,
    branches,
    branchBusy,
    branchError,
    onExpandedChange,
    onOpenDiff,
    onCreateChangeRequest,
    onViewChangeRequest,
    onToggleTerminal,
    onRefreshBranches,
    onRefreshVcsStatus,
    onSelectBranch,
    onCreateBranch,
    quickAction,
    onQuickAction,
  } = input
  const gitAvailable =
    gitStatus !== null ||
    vcsStatus?.isRepo === true ||
    localVcsState === 'loading' ||
    localVcsState === 'error'
  return (
    <SessionSummarySection
      id="environment"
      title="Environment"
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      actions={
        <SessionEnvironmentActions workingPath={workingPath} onToggleTerminal={onToggleTerminal} />
      }
    >
      {gitStatus ? (
        <SessionSummaryRow
          icon={<FolderOpen className="size-4" />}
          label="Changes"
          value={
            <span>
              <span className="text-success">+{gitStatus.additions}</span>{' '}
              <span className="text-error">-{gitStatus.deletions}</span>
            </span>
          }
          onClick={onOpenDiff}
        />
      ) : null}
      <SessionEnvironmentRow environmentMode={environmentMode} workingPath={workingPath} />
      {gitAvailable ? (
        <>
          <SessionBranchRow
            branch={gitStatus?.branch ?? vcsStatus?.refName ?? null}
            branches={branches}
            busy={branchBusy}
            error={branchError}
            onRefresh={onRefreshBranches}
            onSelect={onSelectBranch}
            onCreate={onCreateBranch}
          />
          <SessionSummaryRow
            icon={<GitCommit className="size-4" />}
            label={quickAction.label}
            disabledReason={quickAction.disabled ? quickAction.hint : undefined}
            onClick={onQuickAction}
          />
        </>
      ) : null}
      <ChangeRequestSummaryRow
        gitStatus={gitStatus}
        vcsStatus={vcsStatus}
        remoteVcsState={remoteVcsState}
        onCreate={onCreateChangeRequest}
        onView={onViewChangeRequest}
        onRefresh={onRefreshVcsStatus}
      />
    </SessionSummarySection>
  )
}

export interface ResourceSummarySectionInput {
  readonly title: 'Outputs' | 'Sources'
  readonly resources: readonly SessionResource[]
  readonly count?: number
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
  readonly onOpenResources: (target: SessionResourceBrowserTarget) => void
  readonly onOpenImage: (resourceId: string) => void
  readonly onAttachSource?: () => void
  readonly onReferenceSource?: () => void
}

export function ResourceSummarySection({
  input: {
    title,
    resources,
    count,
    expanded,
    onExpandedChange,
    onOpenResources,
    onOpenImage,
    onAttachSource,
    onReferenceSource,
  },
}: {
  readonly input: ResourceSummarySectionInput
}) {
  if (title === 'Outputs' && (count ?? resources.length) === 0) return null
  const view = title === 'Outputs' ? 'outputs' : 'sources'
  const openResource = (resource: SessionResource) => {
    if (isViewableSessionImage(resource)) {
      onOpenImage(resource.id)
      return
    }
    onOpenResources({ view, resourceId: resource.id })
  }
  return (
    <SessionSummarySection
      id={title.toLowerCase()}
      title={title}
      count={count ?? resources.length}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      actions={
        title === 'Sources' && onAttachSource && onReferenceSource ? (
          <SessionSourceAddMenu
            onAttachFiles={onAttachSource}
            onReferenceProjectFile={onReferenceSource}
          />
        ) : undefined
      }
    >
      {title === 'Outputs' ? (
        <section aria-label="Outputs list" className="max-h-80 overflow-y-auto overscroll-contain">
          <SessionSummaryPaginatedList
            items={resources}
            getKey={(resource) => resource.id}
            renderItem={(resource) => (
              <SessionSummaryRow
                icon={
                  resource.kind === 'image' ? (
                    <Images className="size-4" />
                  ) : (
                    <FileOutput className="size-4" />
                  )
                }
                label={resource.title}
                onClick={() => openResource(resource)}
              />
            )}
          />
        </section>
      ) : (
        resources
          .slice(0, SUMMARY_RESOURCE_LIMIT)
          .map((resource) => (
            <SessionSummaryRow
              key={resource.id}
              icon={
                resource.kind === 'image' ? (
                  <Images className="size-4" />
                ) : (
                  <FolderOpen className="size-4" />
                )
              }
              label={resource.title}
              onClick={() => openResource(resource)}
            />
          ))
      )}
      <SessionSummaryRow
        icon={<ChevronRight className="size-4" />}
        label="Show all"
        onClick={() => onOpenResources({ view })}
      />
    </SessionSummarySection>
  )
}
