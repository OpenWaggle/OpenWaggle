import {
  callMcpAppToolOperation,
  readMcpResourceOperation,
} from '../application/mcp-app-operations'
import {
  listMcpSecretsOperation,
  removeMcpSecretOperation,
  setMcpSecretOperation,
} from '../application/mcp-secret-operations'
import { hostHandle } from './typed-ipc'

export function registerMcpHandlers(): void {
  hostHandle('mcp:list-secrets', () => listMcpSecretsOperation())
  hostHandle('mcp:set-secret', (_event, raw: unknown) => setMcpSecretOperation(raw))
  hostHandle('mcp:remove-secret', (_event, raw: unknown) => removeMcpSecretOperation(raw))
  hostHandle('mcp:read-resource', (_event, raw: unknown) => readMcpResourceOperation(raw))
  hostHandle('mcp:call-app-tool', (_event, raw: unknown) => callMcpAppToolOperation(raw))
}
