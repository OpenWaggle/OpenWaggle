/**
 * Vault secrets of a Run's servers that are off are read only when Pi connects one (Pi's `/mcp`
 * may turn it on during the Run), so a Run with no server on reads no keychain. Until then the
 * value is a marker naming the secret. It holds a NUL character, which no process environment or
 * HTTP header accepts, so a marker that reached a server would fail rather than pass as a value.
 */
import { piLiteral } from '../../../domain/mcp/config/mcp-pi-literal'
import type { McpServerConfig } from '../../../domain/mcp/config/mcp-server-config'

const DEFERRED_SECRET_PREFIX = '\u0000openwaggle-vault-secret\u0000'

export function deferredMcpSecret(name: string) {
  return `${DEFERRED_SECRET_PREFIX}${name}`
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function resolveMarkers(
  values: Readonly<Record<string, string>> | undefined,
  resolveSecret: (name: string) => Promise<string>,
) {
  if (!values) return undefined
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (!value.startsWith(DEFERRED_SECRET_PREFIX)) {
      resolved[key] = value
      continue
    }
    const name = value.slice(DEFERRED_SECRET_PREFIX.length)
    try {
      // A secret is data: Pi must never read it as `${VAR}` or run it as `!command`.
      resolved[key] = piLiteral(await resolveSecret(name))
    } catch (error) {
      throw new Error(
        `"${key}" names vault secret "${name}", which could not be read: ${describeError(error)}`,
        { cause: error },
      )
    }
  }
  return resolved
}

/** A server's configuration with the secrets deferred at load read from the vault. */
export async function resolveDeferredMcpSecrets(
  config: McpServerConfig,
  resolveSecret: (name: string) => Promise<string>,
): Promise<McpServerConfig> {
  if ('url' in config) {
    const headers = await resolveMarkers(config.headers, resolveSecret)
    return headers ? { ...config, headers } : config
  }
  const env = await resolveMarkers(config.env, resolveSecret)
  return env ? { ...config, env } : config
}
