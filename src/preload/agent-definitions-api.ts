import { invoke } from './ipc-bindings'

/** Agent definitions: their sources, display, previews, and enablement. */
export const agentDefinitionsApi = {
  selectAgentDefinitionSource: invoke('agent-definitions:select-source'),
  manageAgentDefinitions: invoke('agent-definitions:manage'),
  listAgentDefinitionDisplay: invoke('agent-definitions:list-display'),
  getAgentDefinitionPreview: invoke('agent-definitions:get-preview'),
  setAgentDefinitionEnabled: invoke('agent-definitions:set-enabled'),
}
