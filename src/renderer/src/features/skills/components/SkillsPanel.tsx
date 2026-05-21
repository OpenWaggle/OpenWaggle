import type { SkillCatalogResult, SkillDiscoveryItem } from '@shared/types/standards'
import { RefreshCw, Sparkles } from 'lucide-react'
import { useProject } from '@/features/sessions/hooks'
import { useSkills } from '@/features/skills/hooks/useSkills'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Spinner } from '@/shared/ui/Spinner'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import { SkillPreviewPane } from './SkillPreviewPane'
import { StatusBadge } from './SkillStatusBadge'
import { EmptySkillsState, NoProjectState } from './SkillsPanelStates'

type StandardsStatus = ReturnType<typeof useSkills>['standardsStatus']

function SkillsPanelHeader({ onRefresh }: { readonly onRefresh: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-5 py-3">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Skills</h2>
        <p className="text-[12px] text-text-tertiary">Discover and manage project skills.</p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        leftIcon={<RefreshCw className="size-3.5" />}
        onClick={onRefresh}
      >
        Refresh
      </Button>
    </div>
  )
}

function StandardsSection({
  projectPath,
  standardsStatus,
}: {
  readonly projectPath: string
  readonly standardsStatus: StandardsStatus
}) {
  return (
    <section className="border-b border-border px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-text-secondary">AGENTS.md</span>
        <StatusBadge status={standardsStatus?.agents ?? 'missing'} />
      </div>
      <p className="mt-1 truncate text-[11px] text-text-tertiary">
        {standardsStatus?.agentsPath || `${projectPath}/AGENTS.md`}
      </p>
      {standardsStatus?.error && (
        <p className="mt-1 text-[11px] text-error">{standardsStatus.error}</p>
      )}
    </section>
  )
}

function SkillListItem({
  skill,
  selected,
  onSelect,
  onToggle,
}: {
  readonly skill: SkillDiscoveryItem
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onToggle: (enabled: boolean) => void
}) {
  return (
    <div
      className={cn(
        'flex w-full items-start gap-2 rounded-md border px-2.5 py-2 transition-colors',
        selected
          ? 'border-accent/40 bg-bg-hover'
          : 'border-transparent hover:border-border hover:bg-bg-hover/70',
      )}
    >
      <Button
        variant="unstyled"
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-[12px] font-medium text-text-primary">
          {skill.name}
        </span>
        <p className="mt-1 text-[11px] text-text-tertiary">
          {skill.description || 'No description'}
        </p>
        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-text-muted">
          <span>{skill.id}</span>
          {skill.hasScripts && (
            <span className="inline-flex items-center gap-1">
              <Sparkles className="size-3" />
              scripts
            </span>
          )}
          {skill.loadStatus === 'error' && <span className="text-error">invalid</span>}
        </div>
      </Button>
      <ToggleSwitch
        checked={skill.enabled}
        label={`${skill.enabled ? 'Disable' : 'Enable'} ${skill.name}`}
        size="compact"
        onCheckedChange={onToggle}
      />
    </div>
  )
}

function SkillsList({
  catalog,
  isLoading,
  selectedSkillId,
  selectSkill,
  toggleSkill,
}: {
  readonly catalog: SkillCatalogResult | null
  readonly isLoading: boolean
  readonly selectedSkillId: string | null
  readonly selectSkill: (skillId: string) => void
  readonly toggleSkill: (skillId: string, enabled: boolean) => Promise<void>
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-text-tertiary">
        <Spinner />
      </div>
    )
  }

  if ((catalog?.skills.length ?? 0) === 0) {
    return <EmptySkillsState />
  }

  return (
    <div className="space-y-1">
      {catalog?.skills.map((skill) => (
        <SkillListItem
          key={skill.id}
          skill={skill}
          selected={selectedSkillId === skill.id}
          onSelect={() => selectSkill(skill.id)}
          onToggle={(enabled) => void toggleSkill(skill.id, enabled)}
        />
      ))}
    </div>
  )
}

function SkillsSidebar({
  projectPath,
  standardsStatus,
  catalog,
  isLoading,
  selectedSkillId,
  selectSkill,
  toggleSkill,
}: {
  readonly projectPath: string
  readonly standardsStatus: StandardsStatus
  readonly catalog: SkillCatalogResult | null
  readonly isLoading: boolean
  readonly selectedSkillId: string | null
  readonly selectSkill: (skillId: string) => void
  readonly toggleSkill: (skillId: string, enabled: boolean) => Promise<void>
}) {
  return (
    <div className="flex min-h-0 flex-col border-r border-border">
      <StandardsSection projectPath={projectPath} standardsStatus={standardsStatus} />
      <section className="min-h-0 flex-1 overflow-y-auto p-2">
        <SkillsList
          catalog={catalog}
          isLoading={isLoading}
          selectedSkillId={selectedSkillId}
          selectSkill={selectSkill}
          toggleSkill={toggleSkill}
        />
      </section>
    </div>
  )
}

function SkillsPanelContent({ projectPath }: { readonly projectPath: string }) {
  const {
    standardsStatus,
    catalog,
    selectedSkillId,
    previewMarkdown,
    isLoading,
    isPreviewLoading,
    error,
    refresh,
    selectSkill,
    toggleSkill,
  } = useSkills(projectPath)
  const selectedSkill = catalog?.skills.find((skill) => skill.id === selectedSkillId) ?? null

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <SkillsPanelHeader onRefresh={() => void refresh()} />
      <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr]">
        <SkillsSidebar
          projectPath={projectPath}
          standardsStatus={standardsStatus}
          catalog={catalog}
          isLoading={isLoading}
          selectedSkillId={selectedSkillId}
          selectSkill={selectSkill}
          toggleSkill={toggleSkill}
        />
        <SkillPreviewPane
          error={error}
          selectedSkill={selectedSkill}
          isPreviewLoading={isPreviewLoading}
          previewMarkdown={previewMarkdown}
        />
      </div>
    </div>
  )
}

export function SkillsPanel() {
  const { projectPath } = useProject()

  if (!projectPath) {
    return <NoProjectState />
  }

  return <SkillsPanelContent projectPath={projectPath} />
}
