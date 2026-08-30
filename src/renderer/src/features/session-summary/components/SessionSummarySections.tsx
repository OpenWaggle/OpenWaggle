import type { GitStatusSummary, VcsStatus } from '@shared/types/git'
import type { SessionResource } from '@shared/types/session-resource'
import { getChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileOutput,
  FolderOpen,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Images,
  Laptop,
} from 'lucide-react'
import type { GitQuickAction } from '@/features/git'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'

const SUMMARY_RESOURCE_LIMIT = 3

function SummarySection({
  title,
  count,
  expanded,
  onExpandedChange,
  children,
}: {
  readonly title: string
  readonly count?: number
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
  readonly children: React.ReactNode
}) {
  return (
    <section className="border-t border-border first:border-t-0">
      <Button
        variant="unstyled"
        className="flex h-10 w-full items-center gap-2 px-3 text-left hover:bg-bg-hover"
        aria-expanded={expanded}
        onClick={() => onExpandedChange(!expanded)}
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <span className="flex-1 text-sm font-medium text-text-primary">{title}</span>
        {count === undefined ? null : <span className="text-xs text-text-tertiary">{count}</span>}
      </Button>
      {expanded ? <div className="space-y-1 px-2 pb-2">{children}</div> : null}
    </section>
  )
}

function SummaryRow({
  icon,
  label,
  value,
  onClick,
  disabled = false,
  title,
}: {
  readonly icon: React.ReactNode
  readonly label: string
  readonly value?: React.ReactNode
  readonly onClick?: () => void
  readonly disabled?: boolean
  readonly title?: string
}) {
  const content = (
    <>
      <span className="text-text-tertiary">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">{label}</span>
      {value === undefined ? null : <span className="shrink-0 text-sm">{value}</span>}
    </>
  )
  return onClick ? (
    <Button
      variant="unstyled"
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-bg-hover"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {content}
    </Button>
  ) : (
    <div className="flex h-8 items-center gap-2 px-2">{content}</div>
  )
}

interface EnvironmentSummarySectionInput {
  readonly expanded: boolean
  readonly environmentMode: 'local' | 'worktree'
  readonly gitStatus: GitStatusSummary | null
  readonly vcsStatus: VcsStatus | null
  readonly onExpandedChange: (expanded: boolean) => void
  readonly onOpenDiff: () => void
  readonly onCreateChangeRequest: () => void
  readonly quickAction: GitQuickAction
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
    gitStatus,
    vcsStatus,
    onExpandedChange,
    onOpenDiff,
    onCreateChangeRequest,
    quickAction,
    onQuickAction,
  } = input
  const terminology = getChangeRequestTerminology(vcsStatus?.sourceControlProvider?.id)
  const existing = vcsStatus?.changeRequest
  return (
    <SummarySection title="Environment" expanded={expanded} onExpandedChange={onExpandedChange}>
      <SummaryRow
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
      <SummaryRow
        icon={<Laptop className="size-4" />}
        label={environmentMode === 'worktree' ? 'Worktree' : 'Local'}
      />
      <SummaryRow
        icon={<GitBranch className="size-4" />}
        label={gitStatus?.branch ?? vcsStatus?.refName ?? 'No ref'}
      />
      <SummaryRow
        icon={<GitCommit className="size-4" />}
        label={quickAction.label}
        disabled={quickAction.disabled}
        title={quickAction.hint}
        onClick={onQuickAction}
      />
      {existing ? (
        <SummaryRow
          icon={<ExternalLink className="size-4" />}
          label={`Open ${terminology.shortLabel}`}
          onClick={() => void api.openExternal(existing.url)}
        />
      ) : vcsStatus?.sourceControlProvider ? (
        <SummaryRow
          icon={<GitPullRequest className="size-4" />}
          label={`Create ${terminology.shortLabel}`}
          onClick={onCreateChangeRequest}
        />
      ) : null}
    </SummarySection>
  )
}

export function ResourceSummarySection({
  title,
  resources,
  expanded,
  onExpandedChange,
  onOpenResources,
}: {
  readonly title: 'Outputs' | 'Sources'
  readonly resources: readonly SessionResource[]
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
  readonly onOpenResources: () => void
}) {
  if (resources.length === 0) return null
  return (
    <SummarySection
      title={title}
      count={resources.length}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    >
      {resources.slice(0, SUMMARY_RESOURCE_LIMIT).map((resource) => (
        <SummaryRow
          key={resource.id}
          icon={
            resource.kind === 'image' ? (
              <Images className="size-4" />
            ) : title === 'Outputs' ? (
              <FileOutput className="size-4" />
            ) : (
              <FolderOpen className="size-4" />
            )
          }
          label={resource.title}
          onClick={onOpenResources}
        />
      ))}
      {resources.length > SUMMARY_RESOURCE_LIMIT ? (
        <SummaryRow
          icon={<ChevronRight className="size-4" />}
          label="Show all"
          onClick={onOpenResources}
        />
      ) : null}
    </SummarySection>
  )
}
