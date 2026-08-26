import { ChevronDown, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import openwaggleMark from '@/assets/openwaggle-mark.png'
import { projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'

interface WelcomeScreenProps {
  projectPath: string | null
  hasProject: boolean
  recentProjects: readonly string[]
  onOpenProject?: () => void
  onSelectProjectPath?: (path: string) => Promise<void> | void
}

const WELCOME_KICKER_CLASS = 'text-2xl font-normal tracking-tight text-text-secondary'
const WELCOME_PROJECT_CLASS =
  'text-2xl font-light tracking-tight text-text-primary transition-colors hover:text-text-primary'

export function WelcomeScreen({
  projectPath,
  hasProject,
  recentProjects,
  onOpenProject,
  onSelectProjectPath,
}: WelcomeScreenProps) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)

  function handleChooseProject(path: string) {
    setProjectMenuOpen(false)
    void onSelectProjectPath?.(path)
  }

  return (
    <section
      aria-label="Welcome"
      className="mx-auto flex min-h-full w-full max-w-180 flex-1 items-center justify-center px-5 py-10"
    >
      <div className="flex flex-col items-center text-center">
        <img src={openwaggleMark} alt="OpenWaggle logo" className="size-20 object-contain" />
        <div className="mt-5 space-y-2">
          <h2 className={WELCOME_KICKER_CLASS}>Let&apos;s build</h2>
          {hasProject ? (
            <Popover
              open={projectMenuOpen}
              onOpenChange={setProjectMenuOpen}
              placement="bottom-start"
              className="w-85 p-2 left-1/2 -translate-x-1/2 mt-2"
              trigger={
                <Button
                  variant="unstyled"
                  type="button"
                  onClick={() => setProjectMenuOpen((prev) => !prev)}
                  className={`relative inline-flex max-w-full items-center justify-center px-3 pb-0.5 ${WELCOME_PROJECT_CLASS}`}
                  title="Open project picker"
                >
                  <span className="truncate">{projectName(projectPath)}</span>
                  <ChevronDown className="pointer-events-none absolute right-0 top-1/2 size-5 -translate-y-1/2" />
                </Button>
              }
            >
              <Button
                variant="unstyled"
                type="button"
                onClick={() => {
                  setProjectMenuOpen(false)
                  onOpenProject?.()
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-bg-hover"
              >
                <FolderOpen className="size-3.5 shrink-0" />
                Select folder…
              </Button>

              {recentProjects.length > 0 && (
                <div className="mt-1 border-t border-border pt-1">
                  <div className="px-2.5 py-1 text-xs uppercase tracking-wide text-text-muted">
                    Recent projects
                  </div>
                  {recentProjects.map((path) => (
                    <Button
                      variant="unstyled"
                      key={path}
                      type="button"
                      onClick={() => handleChooseProject(path)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-bg-hover"
                    >
                      <FolderOpen className="size-3.5 shrink-0 text-text-tertiary" />
                      <span className="min-w-0 flex-1 truncate">{projectName(path)}</span>
                      {path === projectPath && (
                        <span className="text-xs text-text-muted">Current</span>
                      )}
                    </Button>
                  ))}
                </div>
              )}
            </Popover>
          ) : (
            <Button
              variant="unstyled"
              type="button"
              onClick={() => {
                onOpenProject?.()
              }}
              className="inline-flex max-w-sm items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-text-tertiary transition-colors hover:border-border-light hover:text-text-secondary"
              title="Open project picker"
            >
              <FolderOpen className="size-4 shrink-0" />
              <span>Select a project folder to get started</span>
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
