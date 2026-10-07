import {
  callMcpAppToolOperation,
  listMcpAppCatalogOperation,
  readMcpResourceOperation,
} from '../application/mcp-app-operations'
import {
  addMcpServerOperation,
  applyMcpImportsOperation,
  getMcpConfigurationOperation,
  getMcpServerStatusesOperation,
  inspectMcpServerOperation,
  installMcpCatalogServerOperation,
  previewMcpImportsOperation,
  removeMcpServerOperation,
  setMcpServerEnabledOperation,
  setMcpServerExposureOperation,
  signInMcpServerOperation,
  signOutMcpServerOperation,
} from '../application/mcp-configuration-operations'
import {
  getMcpRegistryServerOperation,
  installMcpRegistryServerOperation,
  searchMcpRegistryOperation,
} from '../application/mcp-registry-operations'
import {
  listMcpSecretsOperation,
  removeMcpSecretOperation,
  setMcpSecretOperation,
} from '../application/mcp-secret-operations'
import { hostHandle } from './typed-ipc'

export function registerMcpHandlers(): void {
  hostHandle('mcp:get-configuration', (_event, raw: unknown) => getMcpConfigurationOperation(raw))
  hostHandle('mcp:set-server-enabled', (_event, raw: unknown) => setMcpServerEnabledOperation(raw))
  hostHandle('mcp:set-server-exposure', (_event, raw: unknown) =>
    setMcpServerExposureOperation(raw),
  )
  hostHandle('mcp:add-server', (_event, raw: unknown) => addMcpServerOperation(raw))
  hostHandle('mcp:remove-server', (_event, raw: unknown) => removeMcpServerOperation(raw))
  hostHandle('mcp:install-catalog-server', (_event, raw: unknown) =>
    installMcpCatalogServerOperation(raw),
  )
  hostHandle('mcp:inspect-server', (_event, raw: unknown) => inspectMcpServerOperation(raw))
  hostHandle('mcp:get-server-statuses', (_event, raw: unknown) =>
    getMcpServerStatusesOperation(raw),
  )
  hostHandle('mcp:sign-in', (_event, raw: unknown) => signInMcpServerOperation(raw))
  hostHandle('mcp:sign-out', (_event, raw: unknown) => signOutMcpServerOperation(raw))
  hostHandle('mcp:preview-imports', (_event, raw: unknown) => previewMcpImportsOperation(raw))
  hostHandle('mcp:apply-imports', (_event, raw: unknown) => applyMcpImportsOperation(raw))
  hostHandle('mcp:search-registry', (_event, raw: unknown) => searchMcpRegistryOperation(raw))
  hostHandle('mcp:get-registry-server', (_event, raw: unknown) =>
    getMcpRegistryServerOperation(raw),
  )
  hostHandle('mcp:install-registry-server', (_event, raw: unknown) =>
    installMcpRegistryServerOperation(raw),
  )
  hostHandle('mcp:list-secrets', () => listMcpSecretsOperation())
  hostHandle('mcp:set-secret', (_event, raw: unknown) => setMcpSecretOperation(raw))
  hostHandle('mcp:remove-secret', (_event, raw: unknown) => removeMcpSecretOperation(raw))
  hostHandle('mcp:read-resource', (_event, raw: unknown) => readMcpResourceOperation(raw))
  hostHandle('mcp:list-app-catalog', (_event, raw: unknown) => listMcpAppCatalogOperation(raw))
  hostHandle('mcp:call-app-tool', (_event, raw: unknown) => callMcpAppToolOperation(raw))
}
