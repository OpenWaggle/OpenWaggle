import { Type } from 'typebox'
import { sessionsToolProjectPath } from './sessions-tool-catalog-parameters'

const AGENT_DEFINITION_RESULT_LIMIT = 100

/**
 * agent_definitions_list and agent_definitions_search: names and descriptions of a project's
 * Agent definitions, the caller's own project unless projectPath names another.
 */
export const sessionsToolAgentDefinitionParameters = [
  Type.Object({
    action: Type.Literal('agent_definitions_list'),
    projectPath: sessionsToolProjectPath,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: AGENT_DEFINITION_RESULT_LIMIT })),
  }),
  Type.Object({
    action: Type.Literal('agent_definitions_search'),
    query: Type.String({ minLength: 1 }),
    projectPath: sessionsToolProjectPath,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: AGENT_DEFINITION_RESULT_LIMIT })),
  }),
] as const
