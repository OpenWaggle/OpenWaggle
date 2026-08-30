import path from 'node:path'
import type {
  AgentDefinitionImportSource,
  AgentDefinitionScope,
} from '@shared/types/agent-definition'
import type { AgentDefinitionSemanticCatalogLoader } from './agents/agent-definition-management'
import { option, type ParsedArguments } from './mcp-cli-arguments'

export function managementContext(input: {
  readonly home: string
  readonly loadSemanticCatalog: AgentDefinitionSemanticCatalogLoader
}) {
  return { userHome: input.home, loadSemanticCatalog: input.loadSemanticCatalog }
}

export function required(value: string | undefined, label: string) {
  if (!value) throw new Error(`${label} is required.`)
  return value
}

export function agentDefinitionsProjectPath(arguments_: ParsedArguments, cwd: string) {
  return path.resolve(option(arguments_, 'project') ?? cwd)
}

export function parseAgentDefinitionScope(value: string | undefined): AgentDefinitionScope {
  if (value === 'project' || value === 'portable-project' || value === 'user') return value
  throw new Error('--scope must be project, portable-project, or user.')
}

export function parseAgentDefinitionImportSource(
  value: string | undefined,
): AgentDefinitionImportSource | 'auto' {
  if (!value || value === 'auto') return 'auto'
  const sources: readonly AgentDefinitionImportSource[] = [
    'openwaggle',
    'codex',
    'claude-code',
    'cursor',
    'gemini-cli',
    'github-copilot',
    'opencode',
  ]
  const selected = sources.find((source) => source === value)
  if (!selected) throw new Error(`Unsupported Agent import source: ${value}.`)
  return selected
}
