import type { GitBranchInfo, GitStatusSummary, VcsStatus } from '@shared/types/git'
import type { SessionResource } from '@shared/types/session-resource'
import { ChevronRight, FileOutput, FolderOpen, GitBranch, GitCommit, Images } from 'lucide-react'
import { useFocusHandoff } from '@/shared/hooks/useFocusHandoff'
import type { SessionResourceBrowserTarget } from '../model/session-resource-browser'
import { isViewableSessionImage } from '../model/session-resource-viewability'
import type { SessionSummaryGitAction } from '../model/session-summary-git-action'
import type { ChangeRequestOpener } from './ChangeRequestLinkRow'
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
import type { SourceControlSessionTerminal } from './use-source-control-attention-actions'

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
  readonly changeRequestOpener: ChangeRequestOpener
  /** The Session terminal source-control sign-in runs in, when the Session has one. */
  readonly sourceControlTerminal: SourceControlSessionTerminal | null
  readonly onToggleTerminal: () => void
  readonly onRefreshBranches: () => void
  readonly onRefreshVcsStatus: () => void
  readonly onRecheckSourceControl: () => Promise<void>
  readonly onSelectBranch: (branch: string) => Promise<boolean>
  readonly onCreateBranch: (branch: string) => Promise<boolean>
  readonly quickAction: SessionSummaryGitAction
  readonly onQuickAction: () => void
}

/** The disclosure button that heads the Session Summary section around `element`. */
function sectionTrigger(element: HTMLElement) {
  return element.closest('section')?.querySelector<HTMLElement>('button[aria-expanded]') ?? null
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
    changeRequestOpener,
    sourceControlTerminal,
    onToggleTerminal,
    onRefreshBranches,
    onRefreshVcsStatus,
    onRecheckSourceControl,
    onSelectBranch,
    onCreateBranch,
    quickAction,
    onQuickAction,
  } = input
  // A source-control fix swaps the row's notice for another element, or for nothing.
  const changeRequestFocus = useFocusHandoff<HTMLDivElement>({
    target: 'button, a[href]',
    fallback: sectionTrigger,
  })
  const branchKnown = gitStatus !== null || vcsStatus?.isRepo === true
  const gitAvailable = branchKnown || localVcsState === 'loading' || localVcsState === 'error'
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
          {branchKnown ? (
            <SessionBranchRow
              branch={gitStatus?.branch ?? vcsStatus?.refName ?? null}
              branches={branches}
              busy={branchBusy}
              error={branchError}
              onRefresh={onRefreshBranches}
              onSelect={onSelectBranch}
              onCreate={onCreateBranch}
            />
          ) : (
            <SessionSummaryRow
              icon={<GitBranch className="size-4" />}
              label={localVcsState === 'loading' ? 'Loading branch…' : 'Branch unavailable'}
            />
          )}
          <SessionSummaryRow
            icon={<GitCommit className="size-4" />}
            label={quickAction.label}
            disabledReason={quickAction.disabled ? quickAction.hint : undefined}
            onClick={onQuickAction}
          />
        </>
      ) : null}
      <div ref={changeRequestFocus}>
        <ChangeRequestSummaryRow
          gitStatus={gitStatus}
          vcsStatus={vcsStatus}
          remoteVcsState={remoteVcsState}
          opener={changeRequestOpener}
          terminal={sourceControlTerminal}
          onCreate={onCreateChangeRequest}
          onRefresh={onRefreshVcsStatus}
          onRecheckSourceControl={onRecheckSourceControl}
        />
      </div>
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
