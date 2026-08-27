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
        <ComposerDock className="flex w-full min-w-0 items-center gap-1 px-2 py-1.5 text-sm">
          <div className="flex min-w-0 items-center gap-1">
            {section.projectPath ? (
              <ComposerProjectMenu
                onOpenProject={section.onOpenProject}
                onSelectProjectPath={section.onSelectProjectPath}
                projectPath={section.projectPath}
                recentProjects={section.recentProjects}
              />
            ) : null}
            {section.projectPath && strip.visible ? (
              <span aria-hidden="true" className="h-4 w-px bg-border-light" />
            ) : null}
            <SessionContextRow strip={strip} />
            {strip.visible ? (
              <span aria-hidden="true" className="h-4 w-px bg-border-light" />
            ) : null}
            <ComposerBranchRow strip={strip} onToast={section.onToast} />
          </div>
        </ComposerDock>
      </div>
    </fieldset>
  )
}
