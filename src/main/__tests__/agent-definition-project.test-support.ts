import {
  type AgentDefinitionProjectResolver,
  type AgentDefinitionProjectSources,
  resolveAgentDefinitionProject,
} from '../agent-definition-project'

/**
 * The real project resolver over in-memory sources: `projects` are the folders the user opened as
 * projects, `worktrees` maps a ready managed worktree to its Session's project, and `toggles` are
 * the Settings' Agent-definition toggles by project.
 */
export function fakeProjectResolver(input: {
  readonly projects: readonly string[]
  readonly worktrees?: Readonly<Record<string, string>>
  readonly toggles?: () => Readonly<Record<string, Readonly<Record<string, boolean>>>>
  readonly settingsError?: Error
}): AgentDefinitionProjectResolver {
  const sources: AgentDefinitionProjectSources = {
    readSettings: async () => {
      if (input.settingsError) throw input.settingsError
      return {
        agentDefinitionTogglesByProject: input.toggles?.() ?? {},
        projectPath: input.projects[0] ?? null,
        recentProjects: [...input.projects],
        projectDisplayNames: {},
      }
    },
    managedWorktreeProject: async (workingPath) => input.worktrees?.[workingPath] ?? null,
  }
  return (directory: string) => resolveAgentDefinitionProject(directory, sources)
}
