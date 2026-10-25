import {
  type AgentDefinitionProjectResolver,
  type AgentDefinitionProjectSources,
  resolveAgentDefinitionProject,
} from '../agent-definition-project'

/**
 * The real project resolver over in-memory sources: `projects` are the projects OpenWaggle knows,
 * `worktrees` maps a ready managed worktree to its Session's project, and `toggles` are the
 * Settings' Agent-definition toggles by project.
 */
export function fakeProjectResolver(input: {
  readonly projects: readonly string[]
  readonly worktrees?: Readonly<Record<string, string>>
  readonly toggles?: () => Readonly<Record<string, Readonly<Record<string, boolean>>>>
  readonly settingsError?: Error
}): AgentDefinitionProjectResolver & { readonly sources: AgentDefinitionProjectSources } {
  const sources: AgentDefinitionProjectSources = {
    readSettings: async () => {
      if (input.settingsError) throw input.settingsError
      return { agentDefinitionTogglesByProject: input.toggles?.() ?? {} }
    },
    listProjects: async () => input.projects,
    managedWorktreeProject: async (workingPath) => input.worktrees?.[workingPath] ?? null,
  }
  return Object.assign((directory: string) => resolveAgentDefinitionProject(directory, sources), {
    sources,
  })
}
