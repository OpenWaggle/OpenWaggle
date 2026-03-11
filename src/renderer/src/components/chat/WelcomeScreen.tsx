import { ChevronDown, FileText, FolderOpen, Gamepad2, PencilLine } from 'lucide-react'
import { useState } from 'react'
import openwaggleMark from '@/assets/openwaggle-mark.png'
import { Popover } from '@/components/shared/Popover'
import { projectName } from '@/lib/format'

interface WelcomeScreenProps {
  projectPath: string | null
  hasProject: boolean
  recentProjects: readonly string[]
  onOpenProject?: () => void
  onSelectProjectPath?: (path: string) => Promise<void> | void
  onRetry?: (content: string) => void
}

const STARTER_PROMPTS = [
  { label: 'Build a coding game in this repo', icon: Gamepad2 },
  { label: 'Draft a one-page summary of this app', icon: FileText },
  { label: 'Create a refactor plan for this codebase', icon: PencilLine },
]

const WELCOME_KICKER_CLASS =
  'text-[clamp(22px,2.6vw,28px)] leading-[1.12] font-normal tracking-[-0.02em] text-text-secondary'
const WELCOME_PROJECT_CLASS =
  'text-[clamp(28px,3.8vw,40px)] leading-[1.18] font-light tracking-tight text-text-primary transition-colors hover:text-text-primary'

export function WelcomeScreen({
  projectPath,
  hasProject,
  recentProjects,
  onOpenProject,
  onSelectProjectPath,
  onRetry,
}: WelcomeScreenProps): React.JSX.Element {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)

  function handleChooseProject(path: string): void {
    setProjectMenuOpen(false)
    void onSelectProjectPath?.(path)
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[720px] px-5 py-5">
      <div className="flex w-full flex-col pt-8">
        <div className="flex flex-1 items-center justify-center pb-20">
          <div className="flex flex-col items-center text-center">
            <img src={openwaggleMark} alt="OpenWaggle logo" className="h-20 w-20 object-contain" />
            <div className="mt-5 space-y-2">
              <h2 className={WELCOME_KICKER_CLASS}>Let&apos;s build</h2>
              {hasProject ? (
                <Popover
                  open={projectMenuOpen}
                  onOpenChange={setProjectMenuOpen}
                  placement="bottom-start"
                  className="w-[340px] p-2 left-1/2 -translate-x-1/2 mt-2"
                  trigger={
                    <button
                      type="button"
                      onClick={() => setProjectMenuOpen((prev) => !prev)}
                      className={`relative inline-flex max-w-full items-center justify-center px-[0.45em] pb-[0.08em] ${WELCOME_PROJECT_CLASS}`}
                      title="Open project picker"
                    >
                      <span className="truncate">{projectName(projectPath)}</span>
                      <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-5 w-5 -translate-y-1/2" />
                    </button>
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      setProjectMenuOpen(false)
                      onOpenProject?.()
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-secondary transition-colors hover:bg-bg-hover"
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    Select folder…
                  </button>

                  {recentProjects.length > 0 && (
                    <div className="mt-1 border-t border-border pt-1">
                      <div className="px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-muted">
                        Recent projects
                      </div>
                      {recentProjects.map((path) => (
                        <button
                          key={path}
                          type="button"
                          onClick={() => handleChooseProject(path)}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-secondary transition-colors hover:bg-bg-hover"
                        >
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                          <span className="min-w-0 flex-1 truncate">{projectName(path)}</span>
                          {path === projectPath && (
                            <span className="text-[11px] text-text-muted">Current</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </Popover>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onOpenProject?.()
                  }}
                  className="inline-flex max-w-sm items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-text-tertiary transition-colors hover:border-border-light hover:text-text-secondary"
                  title="Open project picker"
                >
                  <FolderOpen className="h-4 w-4 shrink-0" />
                  <span>Select a project folder to get started</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="pb-6">
          <div className="grid grid-cols-3 gap-4">
            {STARTER_PROMPTS.map((prompt) => (
              <button
                type="button"
                key={prompt.label}
                onClick={() => onRetry?.(prompt.label)}
                className="group flex min-h-[98px] flex-col rounded-2xl border border-border bg-bg-secondary px-5 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:bg-bg-hover/45 hover:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]"
              >
                <span className="mb-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-bg/80">
                  <prompt.icon className="h-3.5 w-3.5 text-text-secondary transition-colors group-hover:text-text-primary" />
                </span>
                <p className="text-[14px] leading-snug text-text-primary/92">{prompt.label}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
