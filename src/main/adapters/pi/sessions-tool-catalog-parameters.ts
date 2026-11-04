import { Type } from 'typebox'

/** Which part of the Session catalog list, search, and delegations_list look at. */
export const sessionsToolCatalogScope = Type.Optional(
  Type.Union([Type.Literal('current'), Type.Literal('project'), Type.Literal('all')], {
    description:
      'current (default): your project with every worktree of it. project: the project at projectPath. all: every Session you can reach.',
  }),
)

/**
 * The discovery actions ignore `projectPath` unless catalogScope is `project`. The agent-definition
 * actions read the project it names; they used to accept it and read the caller's own project.
 */
export const sessionsToolProjectPath = Type.Optional(
  Type.String({
    description:
      'Absolute path of a project in OpenWaggle, as list shows it. For list, search, delegations_list, and delegations_conflicts it applies only with catalogScope project. agent_definitions_list and agent_definitions_search read its Agent definitions (your own project by default; another project needs launch or create, and list).',
  }),
)

/**
 * The Agent definition a new Session runs with, for create, launch, spawn, and a Launch schedule.
 * One schema everywhere, so the declared hot schema keeps its description instead of a union.
 */
export const sessionsToolAgentDefinitionName = Type.Optional(
  Type.String({
    description:
      'An Agent definition name from available_agents or agent_definitions_list. The new Session runs with its instructions, model, tools, and workspace; put only the task in objective.',
  }),
)

/** list leaves archived Sessions out by default, like search. */
export const sessionsToolListArchived = Type.Optional(
  Type.Boolean({
    description: 'true lists only archived Sessions; by default list leaves them out.',
  }),
)

/** search leaves archived Sessions out by default; this adds them, marked archived: true. */
export const sessionsToolSearchIncludeArchived = Type.Optional(
  Type.Boolean({
    description:
      'true also searches archived Sessions, which results mark archived: true; by default search leaves them out.',
  }),
)
