import { realpath } from 'node:fs/promises'
import path from 'node:path'
import type { Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import {
  projectOfWorkspacePath,
  userProjectPaths,
} from './adapters/workspace-project-authorization'
import { agentDefinitionTogglesForProject } from './agents/agent-definition-toggle-settings'
import { SettingsService } from './services/settings-service'

/** The project whose Agent definitions and toggles a discovery command reads. */
export interface AgentDefinitionProject {
  readonly projectPath: string
  readonly enabledByName: Readonly<Record<string, boolean>>
}

export type AgentDefinitionProjectResolver = (directory: string) => Promise<AgentDefinitionProject>

export interface AgentDefinitionProjectSources {
  readonly readSettings: () => Promise<
    Pick<
      Settings,
      'agentDefinitionTogglesByProject' | 'projectPath' | 'recentProjects' | 'projectDisplayNames'
    >
  >
  /** The project of the Session whose ready managed worktree is exactly at a path. */
  readonly managedWorktreeProject: (workingPath: string) => Promise<string | null>
}

async function defaultSources(): Promise<AgentDefinitionProjectSources> {
  const [{ installPiRuntimeIntegration }, { runAppEffect }] = await Promise.all([
    import('./runtime-pi-integration'),
    import('./runtime'),
  ])
  installPiRuntimeIntegration()
  const { findManagedWorktreeProjectPath } = await import(
    './store/session-details/workspace-root-authorization'
  )
  return {
    readSettings: () => runAppEffect(Effect.flatMap(SettingsService, (service) => service.get())),
    managedWorktreeProject: findManagedWorktreeProjectPath,
  }
}

/** The directory as given, then its real path when a symlink makes them differ. */
async function spellings(directory: string) {
  const given = path.resolve(directory)
  const real = await realpath(given).catch(() => given)
  return real === given ? [given] : [given, real]
}

/**
 * The project and Agent-definition toggles for discovery from a directory, by the Host's
 * `projectOfWorkspace` rule (`projectOfWorkspacePath`): a folder the user opened as a project is
 * that project; a Session's ready managed worktree, or a directory inside one, stands for the
 * Session's project, which the hive tool and spawn read for a Run there. Anything else, a plain
 * subdirectory of a project included, is its own project, as `create` and `launch` take it.
 * Settings are read first, so a Settings failure lists nothing.
 */
export async function resolveAgentDefinitionProject(
  directory: string,
  sources?: AgentDefinitionProjectSources,
): Promise<AgentDefinitionProject> {
  const resolved = sources ?? (await defaultSources())
  const settings = await resolved.readSettings()
  const candidates = await spellings(directory)
  const projectPath =
    (await projectOfWorkspacePath(
      candidates,
      {
        userProjects: userProjectPaths(settings),
        managedWorktreeProject: resolved.managedWorktreeProject,
      },
      { insideManagedWorktrees: true },
    )) ??
    candidates[0] ??
    path.resolve(directory)
  return {
    projectPath,
    enabledByName: await agentDefinitionTogglesForProject(
      settings.agentDefinitionTogglesByProject,
      projectPath,
    ),
  }
}
