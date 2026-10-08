import type { AgentDefinitionDocument } from '@shared/types/agent-definition'
import {
  agentMcpToolReferenceNamespace,
  isAgentMcpToolReference,
  LEGACY_AGENT_MCP_TOOL_NAMES,
  MCP_REACH_TOOL_NAMES,
} from '../domain/agents/agent-tool-allowlist'
import { mcpNamespace } from '../domain/mcp/config/mcp-server-config'

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

/**
 * The tool names a definition may list: the project's tools, Pi's tools that reach MCP tools,
 * the legacy `mcp`/`mcp_run` entries, and `mcp__<namespace>__…` names and patterns whose
 * namespace is a configured MCP server. Unknown until both catalogs loaded.
 */
function availableTools(
  references: readonly string[] | undefined,
  catalog: AgentDefinitionSemanticCatalog,
) {
  if (!catalog.tools) return undefined
  const mcp = (references ?? []).filter(isAgentMcpToolReference)
  if (mcp.length === 0) return catalog.tools
  const namespaces = new Set((catalog.mcpServers ?? []).map(mcpNamespace))
  const configured = mcp.filter((reference) => {
    const namespace = agentMcpToolReferenceNamespace(reference)
    return namespace !== undefined && namespaces.has(namespace)
  })
  return [...catalog.tools, ...MCP_REACH_TOOL_NAMES, ...LEGACY_AGENT_MCP_TOOL_NAMES, ...configured]
}

/**
 * `mcp__…` tool names cannot be checked while the MCP configuration failed to load. They are
 * reported as that unavailable catalog, with its error, instead of as unknown tools.
 */
function splitUncheckableMcpTools(
  definition: AgentDefinitionDocument,
  catalog: AgentDefinitionSemanticCatalog,
) {
  const tools = definition.tools ?? []
  if (catalog.mcpServers !== undefined) return { tools: definition.tools, mcpTools: [] }
  return {
    tools: tools.filter((tool) => !isAgentMcpToolReference(tool)),
    // One catalog-unavailable diagnostic covers the MCP servers when they are listed too.
    mcpTools: definition.mcpServers?.length ? [] : tools.filter(isAgentMcpToolReference),
  }
}

export function validateAgentDefinitionSemantics(
  definition: AgentDefinitionDocument,
  catalog: AgentDefinitionSemanticCatalog,
): AgentDefinitionSemanticValidation {
  const catalogDiagnostics = catalog.loadDiagnostics ?? []
  const { tools, mcpTools } = splitUncheckableMcpTools(definition, catalog)
  const diagnostics = [
    ...validateReferences({
      resource: 'model',
      references: definition.model ? [definition.model] : undefined,
      available: catalog.models,
      catalogDiagnostics,
    }),
    ...validateReferences({
      resource: 'tool',
      references: tools,
      available: availableTools(tools, catalog),
      catalogDiagnostics,
    }),
    ...validateReferences({
      resource: 'mcp-server',
      references: mcpTools,
      available: undefined,
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
