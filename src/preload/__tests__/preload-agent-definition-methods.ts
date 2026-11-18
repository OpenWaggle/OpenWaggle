import type { OpenWaggleApi } from '@shared/types/openwaggle-api'

export const PRELOAD_AGENT_DEFINITION_METHODS = [
  'selectAgentDefinitionSource',
  'manageAgentDefinitions',
  'listAgentDefinitionDisplay',
  'getAgentDefinitionPreview',
  'setAgentDefinitionEnabled',
] as const satisfies readonly (keyof OpenWaggleApi)[]
