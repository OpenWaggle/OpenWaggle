import { createHash } from 'node:crypto'
import type { AgentDefinitionDocument } from '@shared/types/agent-definition'
import { stringify } from 'yaml'
import { parseAgentDefinition } from './agent-definition-parser'

const FRONTMATTER_ORDER: readonly (keyof Omit<AgentDefinitionDocument, 'instructions'>)[] = [
  '$schema',
  'schemaVersion',
  'name',
  'description',
  'model',
  'reasoning',
  'tools',
  'skills',
  'mcpServers',
  'sessionCapabilities',
  'authorizationMode',
  'workspace',
  'import',
]

function frontmatter(definition: AgentDefinitionDocument) {
  const record: Record<string, unknown> = {}
  for (const key of FRONTMATTER_ORDER) {
    const value = definition[key]
    if (value !== undefined) record[key] = value
  }
  return record
}

export function agentDefinitionSemanticDigest(definition: Omit<AgentDefinitionDocument, 'import'>) {
  return createHash('sha256').update(JSON.stringify(definition)).digest('hex')
}

export function agentDefinitionDocumentDigest(markdown: string) {
  return createHash('sha256').update(markdown).digest('hex')
}

export function serializeAgentDefinition(definition: AgentDefinitionDocument) {
  const markdown = `---\n${stringify(frontmatter(definition), { lineWidth: 0 }).trim()}\n---\n\n${definition.instructions.trim()}\n`
  parseAgentDefinition(markdown)
  return markdown
}
