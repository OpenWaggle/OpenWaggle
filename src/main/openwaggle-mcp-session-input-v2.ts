import { z } from 'zod'
import { validateDelegationsCliOptions } from './delegations-cli-option-contract'
import { buildDelegationsCliPayload } from './delegations-cli-payload'
import type { ParsedArguments } from './mcp-cli-arguments'
import { mcpSessionControlOperationSchemasV2 } from './openwaggle-mcp-session-input-control-schema-v2'
import { mcpSessionQueryLifecycleOperationSchemasV2 } from './openwaggle-mcp-session-input-query-schema-v2'
import type { SessionToolInputV2 } from './openwaggle-mcp-session-input-types-v2'
import { mcpSessionCliOptionsV2 } from './openwaggle-mcp-session-options-v2'
import { mcpSessionPositionalsV2 } from './openwaggle-mcp-session-positionals-v2'
import { buildSessionsCliPayload } from './sessions-cli'
import { validateSessionsCliOptions } from './sessions-cli-option-contract'

export type { SessionToolInputV2 } from './openwaggle-mcp-session-input-types-v2'

const sessionInputDiscriminatedSchemaV2 = z.discriminatedUnion('operation', [
  ...mcpSessionQueryLifecycleOperationSchemasV2,
  ...mcpSessionControlOperationSchemasV2,
])

export const sessionInputSchemaV2: z.ZodType<SessionToolInputV2> = sessionInputDiscriminatedSchemaV2

function parsedInput(input: SessionToolInputV2): {
  readonly command: string
  readonly arguments: ParsedArguments
} {
  const message = input.message ?? input.objective ?? input.title
  const { command, options } = mcpSessionCliOptionsV2(input, message)
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

function validateWorkspaceFields(input: SessionToolInputV2) {
  if (
    (input.baseRef !== undefined || input.startFromOrigin !== undefined) &&
    input.workspace !== 'new-worktree'
  ) {
    throw new Error('baseRef and startFromOrigin require workspace new-worktree.')
  }
}

function isDelegationQuery(operation: SessionToolInputV2['operation']) {
  return (
    operation === 'delegations-list' ||
    operation === 'delegations-read' ||
    operation === 'delegations-conflicts'
  )
}

function validateParsedInput(input: SessionToolInputV2, parsed: ReturnType<typeof parsedInput>) {
  validateResourceFields(input)
  validateWorkspaceFields(input)
  if (isDelegationQuery(input.operation)) {
    validateDelegationsCliOptions(input.operation.slice('delegations-'.length), parsed.arguments)
    return
  }
  validateSessionsCliOptions(parsed.command, parsed.arguments)
}

export function buildMcpSessionPayloadV2(input: SessionToolInputV2) {
  const parsed = parsedInput(input)
  const payload = isDelegationQuery(input.operation)
    ? buildDelegationsCliPayload(input.operation.slice('delegations-'.length), parsed.arguments)
    : buildSessionsCliPayload(parsed.command, parsed.arguments)
  validateParsedInput(input, parsed)
  return payload
}
