import type { McpConfigSourceId, McpServerDefinition } from '@shared/types/mcp'
import { parseMcpConfigFile } from './adapters/mcp/json-files'

interface LogoutConfigSource {
  readonly id: McpConfigSourceId
  readonly label: string
  readonly rawJson: string
  readonly parseError?: string
}

interface LogoutTarget {
  readonly name: string
  readonly sourceId: McpConfigSourceId
}

export function secretReferences(definition: McpServerDefinition) {
  const names = new Set<string>()
  for (const values of [definition.env, definition.headers]) {
    for (const value of Object.values(values ?? {})) {
      if (typeof value !== 'string') names.add(value.secret)
    }
  }
  return [...names].sort()
}

export function partitionLogoutSecretReferences(
  references: readonly string[],
  remainingDefinitions: readonly McpServerDefinition[],
) {
  const shared = new Set(remainingDefinitions.flatMap(secretReferences))
  return {
    removable: references.filter((name) => !shared.has(name)),
    retained: references.filter((name) => shared.has(name)),
  }
}

export function partitionServerLogoutSecretReferences(input: {
  readonly references: readonly string[]
  readonly sources: readonly LogoutConfigSource[]
  readonly target: LogoutTarget
}) {
  const remainingDefinitions: McpServerDefinition[] = []
  const unreadableSources: string[] = []
  for (const source of input.sources) {
    if (source.parseError) {
      unreadableSources.push(source.label)
      continue
    }
    try {
      const config = parseMcpConfigFile(source.rawJson)
      for (const [name, definition] of Object.entries(config.mcpServers ?? config.servers ?? {})) {
        if (source.id !== input.target.sourceId || name !== input.target.name) {
          remainingDefinitions.push(definition)
        }
      }
    } catch {
      unreadableSources.push(source.label)
    }
  }
  const partition = partitionLogoutSecretReferences(input.references, remainingDefinitions)
  if (unreadableSources.length === 0) {
    return { ...partition, retainedUnverified: [], unreadableSources }
  }
  return {
    removable: [],
    retained: partition.retained,
    retainedUnverified: partition.removable,
    unreadableSources,
  }
}
