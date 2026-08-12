import type { McpScopeState } from '@shared/types/mcp'
import { cn } from '@/shared/lib/cn'
import { tildifyPath } from '@/shared/lib/tildify-path'
import { Button } from '@/shared/ui/Button'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import { StatusPill } from './McpSectionPanelPrimitives'

export function projectMasterOn(
  states: Readonly<Record<string, McpScopeState>>,
  projectPath: string,
) {
  return (states[projectPath] ?? 'inherit') !== 'off'
}

/** Global master switch. Off means nothing runs, regardless of per-project settings. */
export function GlobalMasterCard({
  globalOn,
  busy,
  onSetGlobal,
}: {
  readonly globalOn: boolean
  readonly busy: boolean
  readonly onSetGlobal: (on: boolean) => void
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-lg border bg-[#111418] px-4 py-3.5',
        globalOn ? 'border-emerald-500/30' : 'border-border',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-text-primary">Global MCP</div>
        <div className="text-[12px] text-text-tertiary">
          {globalOn
            ? 'Master is on. Configure projects and servers below.'
            : 'Master is off — every project and server is disconnected.'}
        </div>
      </div>
      <StatusPill tone={globalOn ? 'success' : 'neutral'}>{globalOn ? 'On' : 'Off'}</StatusPill>
      <ToggleSwitch
        checked={globalOn}
        disabled={busy}
        label={globalOn ? 'Turn Global MCP off' : 'Turn Global MCP on'}
        onCheckedChange={onSetGlobal}
      />
    </div>
  )
}

/** Left pane: every known project with its own on/off master. */
export function ProjectList({
  projects,
  currentProject,
  projectStates,
  busy,
  projectLabel,
  onSelect,
  onSetMaster,
}: {
  readonly projects: readonly string[]
  readonly currentProject: string | null
  readonly projectStates: Readonly<Record<string, McpScopeState>>
  readonly busy: boolean
  readonly projectLabel: (projectPath: string) => string
  readonly onSelect: (projectPath: string) => void
  readonly onSetMaster: (projectPath: string, on: boolean) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-[#111418]">
      {projects.map((projectPath) => {
        const masterOn = projectMasterOn(projectStates, projectPath)
        return (
          <div
            key={projectPath}
            className={cn(
              'flex items-center gap-3 border-t border-border px-3 py-2.5 first:border-t-0 transition-colors',
              projectPath === currentProject ? 'bg-accent/8' : 'hover:bg-bg-hover',
            )}
          >
            <Button
              variant="unstyled"
              type="button"
              onClick={() => onSelect(projectPath)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block truncate text-[12px] font-medium text-text-primary">
                {projectLabel(projectPath)}
              </span>
              <span className="block truncate text-[10px] text-text-muted">
                {tildifyPath(projectPath)}
              </span>
            </Button>
            <ToggleSwitch
              size="compact"
              checked={masterOn}
              disabled={busy}
              label={`${masterOn ? 'Disable' : 'Enable'} MCP for ${projectLabel(projectPath)}`}
              onCheckedChange={(next) => onSetMaster(projectPath, next)}
            />
          </div>
        )
      })}
    </div>
  )
}
