import { AlertCircle, CheckCircle2, RefreshCw, Sparkles, XCircle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Spinner } from '@/components/shared/Spinner'
import { useProject } from '@/hooks/useProject'
import { useSkills } from '@/hooks/useSkills'
import { cn } from '@/lib/cn'
import {
  safeMarkdownComponents,
  safeMarkdownRehypePlugins,
  safeMarkdownUrlTransform,
} from '@/lib/markdown-safety'

export function SkillsPanel() {
  const { projectPath } = useProject()
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

  if (!projectPath) {
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

  const selectedSkill = catalog?.skills.find((skill) => skill.id === selectedSkillId) ?? null

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Skills</h2>
          <p className="text-[12px] text-text-tertiary">Discover and manage project skills.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void refresh()
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr]">
        <div className="flex min-h-0 flex-col border-r border-border">
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

          <section className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-6 text-text-tertiary">
                <Spinner />
              </div>
            ) : (catalog?.skills.length ?? 0) === 0 ? (
              <div className="rounded-lg border border-border bg-bg-secondary px-3 py-3 text-[12px] text-text-tertiary">
                No skills found under `.openwaggle/skills` or `.agents/skills`.
              </div>
            ) : (
              <div className="space-y-1">
                {catalog?.skills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => selectSkill(skill.id)}
                    className={cn(
                      'w-full rounded-md border px-2.5 py-2 text-left transition-colors',
                      selectedSkillId === skill.id
                        ? 'border-accent/40 bg-bg-hover'
                        : 'border-transparent hover:border-border hover:bg-bg-hover/70',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12px] font-medium text-text-primary">
                        {skill.name}
                      </span>
                      <span
                        role="switch"
                        aria-checked={skill.enabled}
                        aria-label={`${skill.enabled ? 'Disable' : 'Enable'} ${skill.name}`}
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation()
                          void toggleSkill(skill.id, !skill.enabled)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.stopPropagation()
                            event.preventDefault()
                            void toggleSkill(skill.id, !skill.enabled)
                          }
                        }}
                        className={cn(
                          'inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors',
                          skill.enabled ? 'bg-accent' : 'bg-bg-hover',
                        )}
                      >
                        <span
                          className={cn(
                            'block h-3 w-3 rounded-full bg-white transition-transform',
                            skill.enabled ? 'translate-x-3.5' : 'translate-x-0.5',
                          )}
                        />
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-text-tertiary">
                      {skill.description || 'No description'}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2 text-[10px] text-text-muted">
                      <span>{skill.id}</span>
                      {skill.hasScripts && (
                        <span className="inline-flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          scripts
                        </span>
                      )}
                      {skill.loadStatus === 'error' && <span className="text-error">invalid</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-3 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-[12px] text-error">
              {error}
            </div>
          )}

          {!selectedSkill ? (
            <div className="rounded-lg border border-border bg-bg-secondary px-4 py-4 text-[13px] text-text-tertiary">
              Select a skill to preview its instructions.
            </div>
          ) : selectedSkill.loadStatus === 'error' ? (
            <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-4 text-[13px] text-error">
              {selectedSkill.loadError ?? 'This skill file is invalid.'}
            </div>
          ) : isPreviewLoading ? (
            <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
              <Spinner />
              Loading preview...
            </div>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: 'found' | 'missing' | 'error' }) {
  if (status === 'found') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] text-success">
        <CheckCircle2 className="h-3 w-3" />
        Found
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-error/30 bg-error/10 px-2 py-0.5 text-[10px] text-error">
        <XCircle className="h-3 w-3" />
        Error
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-text-tertiary">
      <AlertCircle className="h-3 w-3" />
      Missing
    </span>
  )
}
