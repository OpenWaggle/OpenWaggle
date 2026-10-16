import type { PiSessionContinuationChoice } from '@shared/pi-session-continuation'
import { useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { projectName } from '@/shared/lib/format'
import { createRendererLogger } from '@/shared/lib/logger'
import { SegmentedRadioGroup } from '@/shared/ui/SegmentedRadioGroup'

const logger = createRendererLogger('settings')

type ContinuationOption = PiSessionContinuationChoice | 'ask'

const CONTINUATION_OPTIONS = [
  { value: 'ask', label: 'Ask' },
  { value: 'openwaggle', label: 'OpenWaggle' },
  { value: 'pi', label: 'pi' },
] as const satisfies readonly { readonly value: ContinuationOption; readonly label: string }[]

/**
 * Where a session that pi used last continues when you send from the composer, per project
 * (ADR 0051). The choice is yours only: it stays in this app's settings, not the project's files.
 */
export function PiSessionContinuationSetting() {
  const byProject = usePreferencesStore((state) => state.settings.piSessionContinuationByProject)
  const recentProjects = usePreferencesStore((state) => state.settings.recentProjects)
  const setChoice = usePreferencesStore((state) => state.setProjectPiSessionContinuation)
  const [pendingProject, setPendingProject] = useState<string | null>(null)
  const projects = [...new Set([...recentProjects, ...Object.keys(byProject)])]

  const choose = (projectPath: string, next: ContinuationOption) => {
    if (pendingProject !== null || next === (byProject[projectPath] ?? 'ask')) return
    setPendingProject(projectPath)
    void setChoice(projectPath, next === 'ask' ? null : next)
      .catch((error: unknown) => {
        logger.warn('Failed to update the Pi continuation choice', { error: String(error) })
      })
      .finally(() => setPendingProject(null))
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-text-primary">Pi sessions</h3>
      <div className="overflow-hidden rounded-lg border border-border bg-bg">
        <div className="border-b border-border px-5 py-3 text-xs text-text-tertiary">
          When you send in a session that pi used last, OpenWaggle asks whether to continue it here
          or keep running it in pi. A choice saved for a project applies only to you.
        </div>
        {projects.length === 0 ? (
          <div className="px-5 py-3 text-xs text-text-tertiary">No projects yet.</div>
        ) : (
          projects.map((projectPath, index) => (
            <div
              key={projectPath}
              className={`flex min-h-14 items-center justify-between gap-4 px-5 py-3${index === projects.length - 1 ? '' : ' border-b border-border'}`}
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-text-primary">
                  {projectName(projectPath)}
                </div>
                <div className="truncate text-xs text-text-tertiary" title={projectPath}>
                  {projectPath}
                </div>
              </div>
              <SegmentedRadioGroup
                label={`Continue pi sessions of ${projectName(projectPath)} in`}
                options={CONTINUATION_OPTIONS}
                value={byProject[projectPath] ?? 'ask'}
                pending={pendingProject !== null}
                onSelect={(next) => choose(projectPath, next)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
