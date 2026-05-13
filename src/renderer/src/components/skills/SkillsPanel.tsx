import type { SkillCatalogResult, SkillDiscoveryItem } from '@shared/types/standards'
import { AlertCircle, CheckCircle2, RefreshCw, Sparkles, XCircle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Spinner } from '@/components/shared/Spinner'
import { Button } from '@/components/ui/Button'
import { ToggleSwitch } from '@/components/ui/ToggleSwitch'
import { useProject } from '@/hooks/useProject'
import { useSkills } from '@/hooks/useSkills'
import { cn } from '@/lib/cn'
import {
  safeMarkdownComponents,
  safeMarkdownRehypePlugins,
  safeMarkdownUrlTransform,
} from '@/lib/markdown-safety'

type StandardsStatus = ReturnType<typeof useSkills>['standardsStatus']

function NoProjectState() {
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="rounded-xl border border-border bg-bg-secondary px-6 py-5 text-center">
        <p className="text-sm font-medium text-text-primary">No project selected</p>
        <p className="mt-1 text-[13px] text-text-tertiary">
          Select a project folder to manage AGENTS.md and project skills.
        </p>
      </div>
    </div>
  )
}

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

function EmptySkillsState() {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3 text-[12px] text-text-tertiary">
      No skills found under `.openwaggle/skills` or `.agents/skills`.
    </div>
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
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
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
      </button>
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

function SkillPreviewMarkdown({ previewMarkdown }: { readonly previewMarkdown: string }) {
  return (
    <article className="prose max-w-none text-[13px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={safeMarkdownRehypePlugins}
        urlTransform={safeMarkdownUrlTransform}
        components={safeMarkdownComponents}
      >
        {previewMarkdown}
      </ReactMarkdown>
    </article>
  )
}

function SkillPreviewPane({
  error,
  selectedSkill,
  isPreviewLoading,
  previewMarkdown,
}: {
  readonly error: string | null
  readonly selectedSkill: SkillDiscoveryItem | null
  readonly isPreviewLoading: boolean
  readonly previewMarkdown: string
}) {
  return (
    <div className="min-h-0 overflow-y-auto px-5 py-4">
      {error && (
        <div className="mb-3 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-[12px] text-error">
          {error}
        </div>
      )}
      <SkillPreviewContent
        selectedSkill={selectedSkill}
        isPreviewLoading={isPreviewLoading}
        previewMarkdown={previewMarkdown}
      />
    </div>
  )
}

function SkillPreviewContent({
  selectedSkill,
  isPreviewLoading,
  previewMarkdown,
}: {
  readonly selectedSkill: SkillDiscoveryItem | null
  readonly isPreviewLoading: boolean
  readonly previewMarkdown: string
}) {
  if (!selectedSkill) {
    return (
      <div className="rounded-lg border border-border bg-bg-secondary p-4 text-[13px] text-text-tertiary">
        Select a skill to preview its instructions.
      </div>
    )
  }

  if (selectedSkill.loadStatus === 'error') {
    return (
      <div className="rounded-lg border border-error/30 bg-error/10 p-4 text-[13px] text-error">
        {selectedSkill.loadError ?? 'This skill file is invalid.'}
      </div>
    )
  }

  if (isPreviewLoading) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
        <Spinner />
        Loading preview…
      </div>
    )
  }

  return <SkillPreviewMarkdown previewMarkdown={previewMarkdown} />
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

function StatusBadge({ status }: { status: 'found' | 'missing' | 'error' }) {
  if (status === 'found') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] text-success">
        <CheckCircle2 className="size-3" />
        Found
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-error/30 bg-error/10 px-2 py-0.5 text-[10px] text-error">
        <XCircle className="size-3" />
        Error
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-text-tertiary">
      <AlertCircle className="size-3" />
      Missing
    </span>
  )
}
