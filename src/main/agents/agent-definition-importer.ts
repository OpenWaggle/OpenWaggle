import { createHash } from 'node:crypto'
import type {
  AgentDefinitionDocument,
  AgentDefinitionImportSource,
  AgentDefinitionScope,
} from '@shared/types/agent-definition'
import type {
  AgentDefinitionImportFieldPlan,
  AgentDefinitionImportPlan,
} from '@shared/types/agent-definition-management'
import { mapCodexAgent } from './agent-definition-codex-import'
import { mapForeignMarkdownAgent } from './agent-definition-foreign-markdown'
import { parseAgentDefinition } from './agent-definition-parser'
import { agentDefinitionPath } from './agent-definition-paths'
import {
  type AgentDefinitionSemanticCatalog,
  formatAgentDefinitionSemanticDiagnostics,
  validateAgentDefinitionSemantics,
} from './agent-definition-semantic-validation'
import {
  agentDefinitionDocumentDigest,
  agentDefinitionSemanticDigest,
} from './agent-definition-serializer'
import { readBoundedAgentDefinitionSource } from './agent-definition-source-reader'

interface ImporterInput {
  readonly projectPath: string
  readonly userHome?: string
  readonly sourcePath: string
  readonly sourceTool?: AgentDefinitionImportSource | 'auto'
  readonly sourceName?: string
  readonly targetScope: AgentDefinitionScope
  readonly now: number
  readonly semanticCatalog?: AgentDefinitionSemanticCatalog
}

function sourceTool(input: ImporterInput, content: string): AgentDefinitionImportSource {
  if (input.sourceTool && input.sourceTool !== 'auto') return input.sourceTool
  const normalized = input.sourcePath.toLocaleLowerCase()
  if (normalized.endsWith('.toml')) return 'codex'
  if (normalized.includes('/.claude/')) return 'claude-code'
  if (normalized.includes('/.cursor/')) return 'cursor'
  if (normalized.includes('/.gemini/')) return 'gemini-cli'
  if (normalized.includes('/.github/agents/') || normalized.endsWith('.agent.md')) {
    return 'github-copilot'
  }
  if (normalized.includes('/.opencode/')) return 'opencode'
  try {
    parseAgentDefinition(content)
    return 'openwaggle'
  } catch {
    return 'claude-code'
  }
}

function canonicalFields(document: AgentDefinitionDocument) {
  return Object.entries(document).map(
    ([key, value]): AgentDefinitionImportFieldPlan => ({
      sourceField: key === 'instructions' ? '$body' : key,
      targetField: key,
      disposition: 'mapped',
      detail: 'OpenWaggle field preserved.',
      sourceValue: value,
      mappedValue: value,
    }),
  )
}

async function mappedSource(input: {
  readonly importer: ImporterInput
  readonly sourcePath: string
  readonly tool: AgentDefinitionImportSource
  readonly content: string
}) {
  if (input.tool === 'openwaggle') {
    const document = parseAgentDefinition(input.content)
    const { import: _provenance, ...withoutImport } = document
    return { document: withoutImport, fields: canonicalFields(document), diagnostics: [] }
  }
  if (input.tool === 'codex') {
    return mapCodexAgent(
      {
        sourcePath: input.sourcePath,
        ...(input.importer.sourceName ? { sourceName: input.importer.sourceName } : {}),
      },
      input.content,
    )
  }
  return mapForeignMarkdownAgent({
    sourceTool: input.tool,
    sourcePath: input.sourcePath,
    markdown: input.content,
  })
}

async function existingDigest(destinationPath: string) {
  try {
    const existing = await readBoundedAgentDefinitionSource({ sourcePath: destinationPath })
    return { digest: agentDefinitionDocumentDigest(existing.content) }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {}
    const message = error instanceof Error ? error.message : String(error)
    return {
      diagnostic: `Existing Agent definition cannot be safely inspected: ${message}`,
    }
  }
}

export async function planAgentDefinitionImport(
  input: ImporterInput,
): Promise<AgentDefinitionImportPlan> {
  const source = await readBoundedAgentDefinitionSource({ sourcePath: input.sourcePath })
  const resolvedSourcePath = source.sourcePath
  const content = source.content
  const resolvedTool = sourceTool({ ...input, sourcePath: resolvedSourcePath }, content)
  const mapped = await mappedSource({
    importer: input,
    sourcePath: resolvedSourcePath,
    tool: resolvedTool,
    content,
  })
  const sourceDigest = createHash('sha256').update(content).digest('hex')
  const baselineDigest = mapped.document
    ? agentDefinitionSemanticDigest(mapped.document)
    : undefined
  const document =
    mapped.document && baselineDigest
      ? {
          ...mapped.document,
          import: {
            sourceTool: resolvedTool,
            sourcePath: resolvedSourcePath,
            sourceDigest,
            importerVersion: 1 as const,
            baselineDigest,
            importedAt: input.now,
          },
        }
      : undefined
  const destinationPath = agentDefinitionPath({
    scope: input.targetScope,
    projectPath: input.projectPath,
    userHome: input.userHome,
    name: document?.name ?? input.sourceName ?? 'unresolved-import',
  })
  const existing = await existingDigest(destinationPath)
  const diagnostics = [
    ...mapped.diagnostics,
    ...(mapped.document && input.semanticCatalog
      ? formatAgentDefinitionSemanticDiagnostics(
          validateAgentDefinitionSemantics(mapped.document, input.semanticCatalog),
        )
      : []),
    ...(existing.diagnostic ? [existing.diagnostic] : []),
  ]
  return {
    schemaVersion: 1,
    sourceTool: resolvedTool,
    sourcePath: resolvedSourcePath,
    sourceDigest,
    ...(input.sourceName ? { sourceName: input.sourceName } : {}),
    targetScope: input.targetScope,
    destinationPath,
    status: diagnostics.length > 0 ? 'blocked' : existing.digest ? 'conflict' : 'ready',
    fields: mapped.fields,
    diagnostics,
    ...(document ? { document } : {}),
    ...(existing.digest ? { existingContentDigest: existing.digest } : {}),
  }
}
