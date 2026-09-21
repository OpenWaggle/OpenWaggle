import type { AgentDefinitionDocument } from '@shared/types/agent-definition'

export type AgentDefinitionSemanticResource = 'model' | 'tool' | 'skill' | 'mcp-server'

export interface AgentDefinitionSemanticCatalog {
  /** Undefined means the runtime catalog could not be loaded safely. */
  readonly models?: readonly string[]
  /** Undefined means the runtime catalog could not be loaded safely. */
  readonly tools?: readonly string[]
  /** Undefined means the runtime catalog could not be loaded safely. */
  readonly skills?: readonly string[]
  /** Names and stable instance IDs are both valid MCP references. */
  readonly mcpServers?: readonly string[]
  readonly loadDiagnostics?: readonly string[]
}

export interface AgentDefinitionSemanticDiagnostic {
  readonly code: 'catalog-unavailable' | 'duplicate-reference' | 'unknown-reference'
  readonly resource: AgentDefinitionSemanticResource
  readonly value?: string
  readonly message: string
}

export interface AgentDefinitionSemanticValidation {
  readonly valid: boolean
  readonly diagnostics: readonly AgentDefinitionSemanticDiagnostic[]
}

const MAX_AVAILABLE_EXAMPLES = 8

function resourceLabel(resource: AgentDefinitionSemanticResource) {
  if (resource === 'mcp-server') return 'MCP server'
  return resource
}

function availableHint(values: readonly string[]) {
  if (values.length === 0) return 'No values are currently available in this project.'
  const examples = [...new Set(values)].sort().slice(0, MAX_AVAILABLE_EXAMPLES)
  const suffix =
    values.length > examples.length ? ` (and ${values.length - examples.length} more)` : ''
  return `Available values: ${examples.join(', ')}${suffix}.`
}

function validateReferences(input: {
  readonly resource: AgentDefinitionSemanticResource
  readonly references: readonly string[] | undefined
  readonly available: readonly string[] | undefined
  readonly catalogDiagnostics: readonly string[]
}) {
  if (!input.references || input.references.length === 0) return []
  const label = resourceLabel(input.resource)
  if (!input.available) {
    const detail = input.catalogDiagnostics.join(' ') || 'The runtime catalog did not load.'
    return [
      {
        code: 'catalog-unavailable',
        resource: input.resource,
        message: `Cannot validate ${label} references because its project catalog is unavailable. ${detail} Fix catalog loading, then run \`openwaggle agents validate\` again.`,
      },
    ] satisfies AgentDefinitionSemanticDiagnostic[]
  }

  const available = new Set(input.available)
  const seen = new Set<string>()
  const diagnostics: AgentDefinitionSemanticDiagnostic[] = []
  for (const reference of input.references) {
    if (seen.has(reference)) {
      diagnostics.push({
        code: 'duplicate-reference',
        resource: input.resource,
        value: reference,
        message: `Duplicate ${label} reference ${JSON.stringify(reference)}. Remove the duplicate entry.`,
      })
      continue
    }
    seen.add(reference)
    if (!available.has(reference)) {
      diagnostics.push({
        code: 'unknown-reference',
        resource: input.resource,
        value: reference,
        message: `Unknown ${label} reference ${JSON.stringify(reference)}. ${availableHint(input.available)}`,
      })
    }
  }
  return diagnostics
}

export function validateAgentDefinitionSemantics(
  definition: AgentDefinitionDocument,
  catalog: AgentDefinitionSemanticCatalog,
): AgentDefinitionSemanticValidation {
  const catalogDiagnostics = catalog.loadDiagnostics ?? []
  const diagnostics = [
    ...validateReferences({
      resource: 'model',
      references: definition.model ? [definition.model] : undefined,
      available: catalog.models,
      catalogDiagnostics,
    }),
    ...validateReferences({
      resource: 'tool',
      references: definition.tools,
      available: catalog.tools,
      catalogDiagnostics,
    }),
    ...validateReferences({
      resource: 'skill',
      references: definition.skills,
      available: catalog.skills,
      catalogDiagnostics,
    }),
    ...validateReferences({
      resource: 'mcp-server',
      references: definition.mcpServers,
      available: catalog.mcpServers,
      catalogDiagnostics,
    }),
  ]
  return { valid: diagnostics.length === 0, diagnostics }
}

export function formatAgentDefinitionSemanticDiagnostics(
  validation: AgentDefinitionSemanticValidation,
) {
  return validation.diagnostics.map((diagnostic) => diagnostic.message)
}
