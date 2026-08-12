import type { McpConfigCredentialValue, McpSecretReference } from '@shared/types/mcp'
import type { McpSecretResolver } from './types'

function isSecretReference(value: McpConfigCredentialValue): value is McpSecretReference {
  return typeof value === 'object' && value !== null && typeof value.secret === 'string'
}

export async function resolveMcpCredentialMap(
  values: Readonly<Record<string, McpConfigCredentialValue>> | undefined,
  resolveSecret: McpSecretResolver,
) {
  if (!values) return {}
  const resolvedEntries = await Promise.all(
    Object.entries(values).map(
      async ([name, value]) =>
        [name, isSecretReference(value) ? await resolveSecret(value.secret) : value] as const,
    ),
  )
  return Object.fromEntries(resolvedEntries)
}
