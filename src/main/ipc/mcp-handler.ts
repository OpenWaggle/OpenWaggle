import { authorizeMcpServerOperation } from '../application/mcp-authorization-operation'
import {
  addMcpServerOperation,
  applyMcpImportsOperation,
  doctorMcpOperation,
  getMcpSettingsOperation,
  listMcpSecretsOperation,
  logoutMcpServerOperation,
  previewMcpImportsOperation,
  removeMcpSecretOperation,
  removeMcpServerOperation,
  setMcpProjectServerEnabledOperation,
  setMcpScopeStateOperation,
  setMcpSecretOperation,
  setMcpServerEnabledOperation,
  setMcpServerTrustOperation,
  writeMcpSourceConfigOperation,
} from '../application/mcp-management-operations'
import { registerMcpCapabilityHandlers } from './mcp-capability-handler'
import { hostHandle } from './typed-ipc'

function registerMcpConfigHandlers() {
  hostHandle('mcp:get-settings', (_event, raw = {}) => getMcpSettingsOperation(raw))
  hostHandle('mcp:set-scope-state', (_event, raw: unknown) => setMcpScopeStateOperation(raw))
  hostHandle('mcp:set-server-enabled', (_event, raw: unknown) => setMcpServerEnabledOperation(raw))
  hostHandle('mcp:set-project-server-enabled', (_event, raw: unknown) =>
    setMcpProjectServerEnabledOperation(raw),
  )
  hostHandle('mcp:set-server-trust', (_event, raw: unknown) => setMcpServerTrustOperation(raw))
  hostHandle('mcp:write-source-config', (_event, raw: unknown) =>
    writeMcpSourceConfigOperation(raw),
  )
  hostHandle('mcp:remove-server', (_event, raw: unknown) => removeMcpServerOperation(raw))
  hostHandle('mcp:logout-server', (_event, raw: unknown) => logoutMcpServerOperation(raw))
}

function registerMcpAuthorizationHandlers() {
  hostHandle('mcp:authorize-server', (_event, raw: unknown) => authorizeMcpServerOperation(raw))
}

function registerMcpDiscoveryHandlers() {
  hostHandle('mcp:add-server', (_event, raw: unknown) => addMcpServerOperation(raw))
  hostHandle('mcp:preview-imports', (_event, raw: unknown) => previewMcpImportsOperation(raw))
  hostHandle('mcp:apply-imports', (_event, raw: unknown) => applyMcpImportsOperation(raw))
  hostHandle('mcp:doctor', (_event, raw = {}) => doctorMcpOperation(raw))
}

function registerMcpSecretHandlers() {
  hostHandle('mcp:list-secrets', () => listMcpSecretsOperation())
  hostHandle('mcp:set-secret', (_event, raw: unknown) => setMcpSecretOperation(raw))
  hostHandle('mcp:remove-secret', (_event, raw: unknown) => removeMcpSecretOperation(raw))
}

export function registerMcpHandlers(): void {
  registerMcpConfigHandlers()
  registerMcpAuthorizationHandlers()
  registerMcpDiscoveryHandlers()
  registerMcpSecretHandlers()
  registerMcpCapabilityHandlers()
}
