import type { McpMergedServer } from '../../../domain/mcp/config/mcp-config-merge'
import { piLiteral } from '../../../domain/mcp/config/mcp-pi-literal'
import type {
  McpConfiguredValue,
  McpServerConfig,
} from '../../../domain/mcp/config/mcp-server-config'
import { McpVaultError } from '../../../ports/mcp-errors'

export type McpSecretResolver = (name: string) => Promise<string>

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

type ResolvedValues =
  | { readonly ok: true; readonly values: Record<string, string> | undefined }
  | { readonly ok: false; readonly error: string; readonly missingSecret?: true }

async function resolveValues(
  server: McpMergedServer,
  field: 'env' | 'headers',
  values: Readonly<Record<string, McpConfiguredValue>> | undefined,
  resolveSecret: McpSecretResolver,
) {
  if (!values) {
    const result: ResolvedValues = { ok: true, values: undefined }
    return result
  }
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') {
      resolved[key] = value
      continue
    }
    try {
      // A secret is data: Pi must never read it as `${VAR}` or run it as `!command`.
      resolved[key] = piLiteral(await resolveSecret(value.secret))
    } catch (error) {
      const missing = error instanceof McpVaultError && error.reason === 'secret-not-found'
      const result: ResolvedValues = {
        ok: false,
        error: `${server.source.path}: server "${server.name}": ${field} "${key}" names vault secret "${value.secret}", which could not be read: ${errorMessage(error)}`,
        ...(missing ? { missingSecret: true as const } : {}),
      }
      return result
    }
  }
  const result: ResolvedValues = { ok: true, values: resolved }
  return result
}

type ResolvedServer =
  | { readonly ok: true; readonly config: McpServerConfig }
  | { readonly ok: false; readonly error: string; readonly missingSecret?: true }

/** A server's config with its vault secrets read, or why one of them could not be read. */
export async function resolveServer(server: McpMergedServer, resolveSecret: McpSecretResolver) {
  const { config } = server
  if ('url' in config) {
    const { headers, ...rest } = config
    const resolved = await resolveValues(server, 'headers', headers, resolveSecret)
    if (!resolved.ok) return resolved
    return {
      ok: true,
      config: { ...rest, ...(resolved.values ? { headers: resolved.values } : {}) },
    } satisfies ResolvedServer
  }
  const { env, ...rest } = config
  const resolved = await resolveValues(server, 'env', env, resolveSecret)
  if (!resolved.ok) return resolved
  return {
    ok: true,
    config: { ...rest, ...(resolved.values ? { env: resolved.values } : {}) },
  } satisfies ResolvedServer
}
