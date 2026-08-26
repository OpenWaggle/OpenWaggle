import type { McpSettingsView } from '@shared/types/mcp'
import { useState } from 'react'
import { useMcpProjectControl } from '@/features/settings/hooks/useMcpProjectControl'
import { cn } from '@/shared/lib/cn'
import { GlobalMasterCard, ProjectList, projectMasterOn } from './McpProjectControlParts'
import { McpProjectServerDetail } from './McpProjectServerDetail'

function resolveProjects(recentProjects: readonly string[], activeProject: string | null) {
  if (recentProjects.length > 0) return recentProjects
  return activeProject ? [activeProject] : []
}

/**
 * MCP activation as a Global master switch plus an independent on/off per
 * project, and — for the selected project — an on/off per individual server
 * (shared global servers + the project's own). Global off locks everything;
 * per-server overrides are isolated per project by the backend.
 */
export function McpProjectControl({
  view,
  busy,
  recentProjects,
  projectLabel,
  onSetGlobal,
  onChanged,
}: {
  readonly view: McpSettingsView | null
  readonly busy: boolean
  readonly recentProjects: readonly string[]
  readonly projectLabel: (projectPath: string) => string
  readonly onSetGlobal: (on: boolean) => void
  readonly onChanged: () => void
}) {
  const activeProject = view?.projectPath ?? null
  const projects = resolveProjects(recentProjects, activeProject)
  const [selected, setSelected] = useState<string | null>(null)
  // `selected` starts null (view is not loaded on first render); fall back to
  // the active project, then the first known project.
  const currentProject = selected ?? activeProject ?? projects[0] ?? null
  const { detail, loading, error, setProjectMaster, setServerEnabled } = useMcpProjectControl(
    currentProject,
    onChanged,
  )

  if (!view) return null
  const globalOn = view.integration.desired.global === 'on'
  const gridBusy = busy || !globalOn

  return (
    <section aria-labelledby="mcp-projects-heading" className="space-y-3">
      <div>
        <h3 id="mcp-projects-heading" className="text-base font-semibold text-text-primary">
          Activation
        </h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Global master, then on/off per project. When Global is off nothing runs. Disabling a
          server for one project never affects other projects.
        </p>
      </div>

      <GlobalMasterCard globalOn={globalOn} busy={busy} onSetGlobal={onSetGlobal} />

      {error && (
        <p role="alert" className="text-xs text-error-text">
          {error}
        </p>
      )}

      {projects.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg px-4 py-6 text-center text-xs text-text-muted">
          Open a project to configure per-project MCP.
        </div>
      ) : (
        <div
          className={cn(
            'grid grid-cols-[minmax(220px,300px)_1fr] gap-4',
            !globalOn && 'pointer-events-none opacity-40',
          )}
        >
          <ProjectList
            projects={projects}
            currentProject={currentProject}
            projectStates={view.projectStates}
            busy={gridBusy}
            projectLabel={projectLabel}
            onSelect={setSelected}
            onSetMaster={setProjectMaster}
          />
          {currentProject && (
            <McpProjectServerDetail
              label={projectLabel(currentProject)}
              projectPath={currentProject}
              servers={detail?.servers ?? []}
              masterOn={projectMasterOn(view.projectStates, currentProject)}
              busy={gridBusy}
              loading={loading && !detail}
              onSetMaster={(on) => setProjectMaster(currentProject, on)}
              onToggleServer={setServerEnabled}
            />
          )}
        </div>
      )}
    </section>
  )
}
