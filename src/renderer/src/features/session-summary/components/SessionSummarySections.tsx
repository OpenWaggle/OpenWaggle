import type { GitBranchInfo, GitStatusSummary, VcsStatus } from '@shared/types/git'
import type { SessionResource } from '@shared/types/session-resource'
import { getChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import {
  ChevronRight,
  ExternalLink,
  FileOutput,
  FolderOpen,
  GitCommit,
  GitPullRequest,
  Images,
  Plus,
} from 'lucide-react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import type { SessionResourceBrowserTarget } from '../model/session-resource-browser'
import { isViewableSessionImage } from '../model/session-resource-viewability'
import type { SessionSummaryGitAction } from '../model/session-summary-git-action'
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

interface EnvironmentSummarySectionInput {
  readonly expanded: boolean
  readonly environmentMode: 'local' | 'worktree'
  readonly workingPath: string | null
  readonly gitStatus: GitStatusSummary | null
  readonly vcsStatus: VcsStatus | null
  readonly branches: readonly GitBranchInfo[]
  readonly branchBusy: boolean
  readonly branchError: string | null
  readonly onExpandedChange: (expanded: boolean) => void
  readonly onOpenDiff: () => void
  readonly onCreateChangeRequest: () => void
  readonly onToggleTerminal: () => void
  readonly onRefreshBranches: () => void
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
    branches,
    branchBusy,
    branchError,
    onExpandedChange,
    onOpenDiff,
    onCreateChangeRequest,
    onToggleTerminal,
    onRefreshBranches,
    onSelectBranch,
    onCreateBranch,
    quickAction,
    onQuickAction,
  } = input
  const terminology = getChangeRequestTerminology(vcsStatus?.sourceControlProvider?.id)
  const existing = vcsStatus?.changeRequest
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
      <SessionSummaryRow
        icon={<FolderOpen className="size-4" />}
        label="Changes"
        value={
          gitStatus ? (
            <span>
              <span className="text-success">+{gitStatus.additions}</span>{' '}
              <span className="text-error">-{gitStatus.deletions}</span>
            </span>
          ) : (
            <span className="text-text-tertiary">—</span>
          )
        }
        onClick={onOpenDiff}
      />
      <SessionEnvironmentRow environmentMode={environmentMode} workingPath={workingPath} />
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
      {existing ? (
        <SessionSummaryRow
          icon={<ExternalLink className="size-4" />}
          label={`Open ${terminology.shortLabel}`}
          onClick={() => void api.openExternal(existing.url)}
        />
      ) : vcsStatus?.sourceControlProvider ? (
        <SessionSummaryRow
          icon={<GitPullRequest className="size-4" />}
          label={`Create ${terminology.shortLabel}`}
          onClick={onCreateChangeRequest}
        />
      ) : null}
    </SessionSummarySection>
  )
}

export function ResourceSummarySection({
  title,
  resources,
  expanded,
  onExpandedChange,
  onOpenResources,
  onOpenImage,
  onAddSource,
}: {
  readonly title: 'Outputs' | 'Sources'
  readonly resources: readonly SessionResource[]
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
  readonly onOpenResources: (target: SessionResourceBrowserTarget) => void
  readonly onOpenImage: (resourceId: string) => void
  readonly onAddSource?: () => void
}) {
  if (resources.length === 0) return null
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
      count={resources.length}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      actions={
        title === 'Sources' && onAddSource ? (
          <Button
            variant="unstyled"
            type="button"
            aria-label="Add a source"
            className="grid size-7 place-items-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            onClick={onAddSource}
          >
            <Plus aria-hidden="true" className="size-4" />
          </Button>
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
      {title === 'Sources' ? (
        <SessionSummaryRow
          icon={<ChevronRight className="size-4" />}
          label="Show all"
          onClick={() => onOpenResources({ view })}
        />
      ) : null}
    </SessionSummarySection>
  )
}
