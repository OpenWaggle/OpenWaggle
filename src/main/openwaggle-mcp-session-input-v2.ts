import { assertSessionExportBranchSelection } from '@shared/session-export-selection'
import type { SessionCapability } from '@shared/types/session-capability'
import { z } from 'zod'
import type { ParsedArguments } from './mcp-cli-arguments'
import { buildMcpSessionExportPayloadV2 } from './openwaggle-mcp-session-export-payload-v2'
import { mcpSessionControlOperationSchemasV2 } from './openwaggle-mcp-session-input-control-schema-v2'
import { mcpSessionQueryLifecycleOperationSchemasV2 } from './openwaggle-mcp-session-input-query-schema-v2'
import type { SessionToolInputV2 } from './openwaggle-mcp-session-input-types-v2'
import { mcpSessionOperationGrantedV2 } from './openwaggle-mcp-session-operation-grants-v2'
import { mcpSessionCliOptionsV2 } from './openwaggle-mcp-session-options-v2'
import { mcpSessionPositionalsV2 } from './openwaggle-mcp-session-positionals-v2'
import { buildSessionsCliPayload } from './sessions-cli'
import { validateSessionsCliOptions } from './sessions-cli-option-contract'

export type { SessionToolInputV2 } from './openwaggle-mcp-session-input-types-v2'

const sessionInputOperationSchemasV2 = [
  ...mcpSessionQueryLifecycleOperationSchemasV2,
  ...mcpSessionControlOperationSchemasV2,
] as const

const sessionInputDiscriminatedSchemaV2 = z.discriminatedUnion(
  'operation',
  sessionInputOperationSchemasV2,
)

export const sessionInputSchemaV2: z.ZodType<SessionToolInputV2> = sessionInputDiscriminatedSchemaV2

/**
 * The tool input an `mcp serve` process advertises: only the operations its `--grant` values
 * allow (#350), so a client is not offered calls that can only fail. Agent-definition discovery
 * needs no grant and is always listed.
 */
export function sessionInputSchemaForGrantsV2(
  grants: ReadonlySet<SessionCapability>,
): z.ZodType<SessionToolInputV2> {
  const [first, ...rest] = sessionInputOperationSchemasV2.filter((schema) =>
    mcpSessionOperationGrantedV2(schema.shape.operation.value, grants),
  )
  if (!first) throw new Error('The Hive MCP tool has no operation to advertise.')
  return z.discriminatedUnion('operation', [first, ...rest])
}

function parsedInput(input: SessionToolInputV2): {
  readonly command: string
  readonly arguments: ParsedArguments
} {
  const message = input.message ?? input.objective ?? input.title
  const { command, options } = mcpSessionCliOptionsV2(input, message)
  if (
    (input.operation === 'list' ||
      input.operation === 'search' ||
      input.operation === 'delegations-list' ||
      input.operation === 'delegations-conflicts') &&
    input.catalogScope === undefined &&
    input.projectPath === undefined
  ) {
    // An MCP caller's current scope is its Host grants, not the server process's cwd.
    options.set('all', ['true'])
  }
  return {
    command,
    arguments: { positionals: mcpSessionPositionalsV2(input, message), passthrough: [], options },
  }
}

function validateResourceFields(input: SessionToolInputV2) {
  if (input.resourceReferences !== undefined && input.operation !== 'spawn') {
    throw new Error('resourceReferences is supported only by the spawn operation.')
  }
  if (input.exportResources !== undefined && input.operation !== 'export-create') {
    throw new Error('exportResources is supported only by the export-create operation.')
  }
}

function validateExportBranchFields(input: SessionToolInputV2) {
  if (input.operation !== 'export' && input.operation !== 'export-create') return
  assertSessionExportBranchSelection({
    branchScope: input.branchScope,
    ...(input.branchId ? { branchId: input.branchId } : {}),
  })
}

function validateWorkspaceFields(input: SessionToolInputV2) {
  if (
    (input.baseRef !== undefined || input.startFromOrigin !== undefined) &&
    input.workspace !== 'new-worktree'
  ) {
    throw new Error('baseRef and startFromOrigin require workspace new-worktree.')
  }
}

function validateParsedInput(input: SessionToolInputV2, parsed: ReturnType<typeof parsedInput>) {
  validateResourceFields(input)
  validateExportBranchFields(input)
  validateWorkspaceFields(input)
  if (input.operation === 'export') return
  validateSessionsCliOptions(parsed.command, parsed.arguments)
}

export function buildMcpSessionPayloadV2(input: SessionToolInputV2) {
  const parsed = parsedInput(input)
  const payload =
    input.operation === 'export'
      ? buildMcpSessionExportPayloadV2(input)
      : buildSessionsCliPayload(parsed.command, parsed.arguments)
  validateParsedInput(input, parsed)
  return payload
}
