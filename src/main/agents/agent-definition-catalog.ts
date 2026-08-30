import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type {
  AgentDefinitionCatalogItem,
  AgentDefinitionScope,
  ResolvedAgentDefinitionSnapshot,
} from '@shared/types/agent-definition'
import { readBoundAgentDefinitionSources } from './agent-definition-bound-catalog-reader'
import {
  extractAgentDefinitionDeclaredName,
  parseAgentDefinition,
  resolvedAgentDefinitionSnapshot,
} from './agent-definition-parser'

interface DefinitionRoot {
  readonly scope: AgentDefinitionScope
  readonly root: string
  readonly directory: string
}

function roots(projectPath: string, userHome: string): readonly DefinitionRoot[] {
  return [
    {
      scope: 'project',
      root: projectPath,
      directory: path.join(projectPath, '.openwaggle', 'agents'),
    },
    {
      scope: 'portable-project',
      root: projectPath,
      directory: path.join(projectPath, '.agents', 'agents'),
    },
    {
      scope: 'user',
      root: userHome,
      directory: path.join(userHome, '.openwaggle', 'agents'),
    },
  ]
}

async function loadRoot(root: DefinitionRoot): Promise<AgentDefinitionCatalogItem[]> {
  const items = await Promise.all(
    (await readBoundAgentDefinitionSources(root)).map(async (source) => {
      const sourcePath = path.join(root.directory, source.name)
      const fallbackName = path.basename(sourcePath, path.extname(sourcePath))
      try {
        const markdown = source.markdown
        const definition = parseAgentDefinition(markdown)
        return {
          name: definition.name,
          description: definition.description,
          scope: root.scope,
          sourcePath,
          contentDigest: createHash('sha256').update(markdown).digest('hex'),
          definition,
        } satisfies AgentDefinitionCatalogItem
      } catch (error) {
        return {
          name: extractAgentDefinitionDeclaredName(source.markdown) ?? fallbackName,
          description: 'Invalid Agent definition',
          scope: root.scope,
          sourcePath,
          loadError: error instanceof Error ? error.message : String(error),
        } satisfies AgentDefinitionCatalogItem
      }
    }),
  )
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + 1)
  return items.map((item) =>
    (counts.get(item.name) ?? 0) > 1
      ? {
          ...item,
          definition: undefined,
          loadError: `Duplicate Agent definition name ${item.name}.`,
        }
      : item,
  )
}

export async function listAgentDefinitions(input: {
  readonly projectPath: string
  readonly userHome?: string
}): Promise<readonly AgentDefinitionCatalogItem[]> {
  const selected = new Map<string, AgentDefinitionCatalogItem>()
  for (const root of roots(input.projectPath, input.userHome ?? os.homedir())) {
    for (const item of await loadRoot(root)) {
      if (!selected.has(item.name)) selected.set(item.name, item)
    }
  }
  return [...selected.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export async function listAllAgentDefinitions(input: {
  readonly projectPath: string
  readonly userHome?: string
}) {
  const items: AgentDefinitionCatalogItem[] = []
  for (const root of roots(input.projectPath, input.userHome ?? os.homedir())) {
    items.push(...(await loadRoot(root)))
  }
  return items.sort(
    (left, right) => left.name.localeCompare(right.name) || left.scope.localeCompare(right.scope),
  )
}

export async function resolveAgentDefinition(input: {
  readonly projectPath: string
  readonly name: string
  readonly userHome?: string
}): Promise<ResolvedAgentDefinitionSnapshot> {
  const item = (await listAgentDefinitions(input)).find(
    (candidate) => candidate.name === input.name,
  )
  if (!item) throw new Error(`Agent definition ${JSON.stringify(input.name)} was not found.`)
  if (item.loadError || !item.definition) {
    throw new Error(
      `Agent definition ${JSON.stringify(input.name)} is invalid: ${item.loadError ?? 'unknown error'}`,
    )
  }
  return resolvedAgentDefinitionSnapshot(item.definition, item.scope, item.sourcePath)
}

export async function searchAgentDefinitions(input: {
  readonly projectPath: string
  readonly query: string
  readonly userHome?: string
}) {
  const query = input.query.trim().toLocaleLowerCase()
  if (!query) return []
  return (await listAgentDefinitions(input)).filter((item) =>
    `${item.name}\n${item.description}`.toLocaleLowerCase().includes(query),
  )
}
