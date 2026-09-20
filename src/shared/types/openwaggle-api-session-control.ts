import type { AgentDefinitionDisplayItem } from './agent-definition'
import type {
  AgentDefinitionManagementCommand,
  AgentDefinitionManagementOutcome,
} from './agent-definition-management'
import type { CliShimMutationResult, CliShimStatus } from './cli-shim'
import type {
  LocalSessionProfileManagementResponse,
  LocalSessionProfileUiCommand,
} from './local-session-profile-management'
import type {
  SessionControlMutationRequest,
  SessionControlMutationResponse,
} from './session-control'
import type { SessionQueryRequest, SessionQueryResponse } from './session-query'

export interface OpenWaggleSessionControlApi {
  getCliShimStatus(): Promise<CliShimStatus>
  installCliShim(): Promise<CliShimMutationResult>
  removeCliShim(): Promise<CliShimMutationResult>
  selectAgentDefinitionSource(): Promise<string | null>
  manageAgentDefinitions(
    command: AgentDefinitionManagementCommand,
  ): Promise<AgentDefinitionManagementOutcome>
  listAgentDefinitionDisplay(projectPath: string): Promise<readonly AgentDefinitionDisplayItem[]>
  getAgentDefinitionPreview(projectPath: string, name: string): Promise<{ markdown: string }>
  setAgentDefinitionEnabled(projectPath: string, name: string, enabled: boolean): Promise<void>
  manageAccessProfiles(
    command: LocalSessionProfileUiCommand,
  ): Promise<LocalSessionProfileManagementResponse>
  /** Execute a GUI-authored mutation through the same durable Session Control used by CLI/MCP. */
  mutateSessionControl(
    request: SessionControlMutationRequest,
  ): Promise<SessionControlMutationResponse>
  /** Read the canonical Session Host projection used by GUI/CLI/MCP. */
  querySessionControl(request: SessionQueryRequest): Promise<SessionQueryResponse>
}
