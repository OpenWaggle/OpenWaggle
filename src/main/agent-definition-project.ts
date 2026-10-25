import path from 'node:path'
import type { Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { projectLocations } from './adapters/pi/pi-session-project-paths'
import { agentDefinitionTogglesForProject } from './agents/agent-definition-toggle-settings'
import { SettingsService } from './services/settings-service'

/** The project whose Agent definitions and toggles a discovery command reads. */
export interface AgentDefinitionProject {
  readonly projectPath: string
  readonly enabledByName: Readonly<Record<string, boolean>>
}

export type AgentDefinitionProjectResolver = (directory: string) => Promise<AgentDefinitionProject>

export interface AgentDefinitionProjectSources {
  readonly readSettings: () => Promise<Pick<Settings, 'agentDefinitionTogglesByProject'>>
  /** The projects OpenWaggle knows: Settings plus every Session's project root. */
  readonly listProjects: () => Promise<readonly string[]>
  /** The project of the Session whose ready managed worktree is exactly at a path. */
  readonly managedWorktreeProject: (workingPath: string) => Promise<string | null>
}

async function defaultSources(): Promise<AgentDefinitionProjectSources> {
  const [{ installPiRuntimeIntegration }, { runAppEffect }] = await Promise.all([
    import('./runtime-pi-integration'),
    import('./runtime'),
  ])
  installPiRuntimeIntegration()
  const [{ durableMcpProjectPaths }, { findManagedWorktreeProjectPath }] = await Promise.all([
    import('./adapters/pi/mcp/openwaggle-mcp-project-paths'),
    import('./store/session-details/workspace-root-authorization'),
  ])
  return {
    readSettings: () => runAppEffect(Effect.flatMap(SettingsService, (service) => service.get())),
    listProjects: durableMcpProjectPaths,
    managedWorktreeProject: findManagedWorktreeProjectPath,
  }
}

function ancestors(directory: string) {
  const chain: string[] = []
  let current = path.resolve(directory)
  while (true) {
    chain.push(current)
    const parent = path.dirname(current)
    if (parent === current) return chain
    current = parent
  }
}

/**
 * The OpenWaggle project a directory belongs to, as Runs and spawn and launch see it: the most
 * specific known project or ready managed worktree containing it, a worktree standing for its
 * Session's project. A known project wins over a worktree at the same folder, as it does for
 * `WorkspaceProjectAuthorization.projectOfWorkspace`. A directory in neither is its own project.
 */
async function owningOpenWaggleProject(directory: string, sources: AgentDefinitionProjectSources) {
  const known = await projectLocations(await sources.listProjects())
  for (const candidate of ancestors(directory)) {
    const project = known.find(
      (location) => location.projectPath === candidate || location.physicalPath === candidate,
    )
    if (project) return project.projectPath
    const worktreeProject = await sources.managedWorktreeProject(candidate)
    if (worktreeProject) return worktreeProject
  }
  return path.resolve(directory)
}

/**
 * The project and Agent-definition toggles for discovery from a directory: the project root, so a
 * caller in a managed worktree or a subdirectory sees what the hive tool and spawn and launch
 * see there. Settings are read first, so a Settings failure lists nothing.
 */
export async function resolveAgentDefinitionProject(
  directory: string,
  sources?: AgentDefinitionProjectSources,
): Promise<AgentDefinitionProject> {
  const resolved = sources ?? (await defaultSources())
  const settings = await resolved.readSettings()
  const projectPath = await owningOpenWaggleProject(directory, resolved)
  return {
    projectPath,
    enabledByName: await agentDefinitionTogglesForProject(
      settings.agentDefinitionTogglesByProject,
      projectPath,
    ),
  }
}
