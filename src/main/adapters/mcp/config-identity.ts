import { createHash } from 'node:crypto'
import type { McpConfigValue, McpServerDefinition } from '@shared/types/mcp'

function canonicalize(value: McpConfigValue): McpConfigValue {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value

  const result: { [key: string]: McpConfigValue } = {}
  for (const key of Object.keys(value).sort()) {
    const next = value[key]
    if (next !== undefined) result[key] = canonicalize(next)
  }
  return result
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function hashMcpServerDefinition(definition: McpServerDefinition) {
  return sha256(JSON.stringify(canonicalize(definition)))
}

export function createMcpServerIdentityKey(sourcePath: string, serverName: string) {
  return sha256(`${sourcePath}\u0000${serverName}`)
}

export function createMcpRevision(values: readonly string[]) {
  return sha256(values.join('\u0000'))
}
