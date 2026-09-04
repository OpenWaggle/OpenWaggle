import { ComposerBranchRow, ComposerDock } from '@/features/composer/components'
import { SessionContextRow, type SessionContextRowState } from '@/features/git'
import { cn } from '@/shared/lib/cn'
import type { ChatComposerSectionState } from '../model'
import { ComposerProjectMenu } from './ComposerProjectMenu'

interface ComposerSessionSetupDockProps {
  readonly section: ChatComposerSectionState
  readonly strip: SessionContextRowState
}

/** The launch-only environment and ref controls docked into the top of the composer. */
export function ComposerSessionSetupDock({ section, strip }: ComposerSessionSetupDockProps) {
  const worktreeRecovery = strip.sendPlan.kind === 'worktree-missing'
  const visible = section.status === 'ready' && (section.isFirstMessage || worktreeRecovery)

  return (
    <fieldset
      aria-hidden={!visible}
      aria-label="Session setup"
      className={cn(
        'm-0 grid min-w-0 border-0 p-0 transition-[grid-template-rows,opacity,transform] duration-150 ease-out motion-reduce:transition-none',
        visible
          ? 'grid-rows-[1fr] translate-y-0 opacity-100'
          : 'pointer-events-none grid-rows-[0fr] -translate-y-1 opacity-0',
      )}
      inert={!visible}
    >
      <div className={cn('min-h-0', visible ? 'overflow-visible' : 'overflow-hidden')}>
        <ComposerDock className="@container/session-dock w-full min-w-0 px-2 py-1.5 text-sm">
          <div
            className="grid min-w-0 grid-cols-[auto_auto_auto_auto_minmax(0,1fr)] items-center gap-1"
            data-testid="session-setup-dock-row"
          >
            <div className="min-w-0">
              <ComposerProjectMenu
                onOpenProject={section.onOpenProject}
                onSelectProjectPath={section.onSelectProjectPath}
                projectPath={section.projectPath ?? null}
                recentProjects={section.recentProjects}
              />
            </div>
            <span aria-hidden="true" className="h-4 w-px bg-border-light" />
            <div className="min-w-0">
              <SessionContextRow strip={strip} />
            </div>
            <span aria-hidden="true" className="h-4 w-px bg-border-light" />
            <div className="min-w-0" data-testid="session-setup-branch">
              <ComposerBranchRow strip={strip} onToast={section.onToast} />
            </div>
          </div>
        </ComposerDock>
      </div>
    </fieldset>
  )
}
