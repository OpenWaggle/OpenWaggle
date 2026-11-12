import { assertSessionExportBranchSelection } from '@shared/session-export-selection'
import type { SessionCapability } from '@shared/types/session-capability'
import { Schema } from 'effect'
import { standardSchemaWithJson, withAdvertisedJsonSchema } from './effect-standard-schema'
import type { ParsedArguments } from './mcp-cli-arguments'
import { buildMcpSessionExportPayloadV2 } from './openwaggle-mcp-session-export-payload-v2'
import { mcpSessionControlOperationSchemasV2 } from './openwaggle-mcp-session-input-control-schema-v2'
import { mcpSessionQueryLifecycleOperationSchemasV2 } from './openwaggle-mcp-session-input-query-schema-v2'
import type { SessionToolInputV2 } from './openwaggle-mcp-session-input-types-v2'
import { mcpSessionOperationGrantedV2 } from './openwaggle-mcp-session-operation-grants-v2'
import {
  mcpSessionCliOptionsV2,
  mcpSessionStructuredInputV2,
} from './openwaggle-mcp-session-options-v2'
import { mcpSessionPositionalsV2 } from './openwaggle-mcp-session-positionals-v2'
import { buildSessionsCliPayload } from './sessions-cli'
import { validateSessionsCliOptions } from './sessions-cli-option-contract'

export type { SessionToolInputV2 } from './openwaggle-mcp-session-input-types-v2'

const sessionInputOperationSchemasV2 = [
  ...mcpSessionQueryLifecycleOperationSchemasV2,
  ...mcpSessionControlOperationSchemasV2,
] as const

/** Every operation's input, discriminated by `operation`. */
export const sessionInputSchemaV2 = Schema.Union(...sessionInputOperationSchemasV2)

const acceptedSessionInputV2 = standardSchemaWithJson(sessionInputSchemaV2)

/**
 * The operations an `mcp serve` process advertises: only those its `--grant` values allow
 * (#350), so a client is not offered calls that can only fail. Agent-definition discovery needs
 * no grant and is always listed.
 */
export function advertisedSessionInputSchemaV2(grants: ReadonlySet<SessionCapability>) {
  const advertised = sessionInputOperationSchemasV2.filter((schema) =>
    mcpSessionOperationGrantedV2(schema.fields.operation.literals[0], grants),
  )
  if (advertised.length === 0) throw new Error('The Hive MCP tool has no operation to advertise.')
  return Schema.Union(...advertised)
}

/**
 * The tool's input schema: `tools/list` shows the advertised operations, while a call is still
 * validated against every operation. A client that calls one it was not offered then reaches
 * the grant check, whose error names the `--grant` to add, instead of an input-validation error
 * that reads like a typo.
 */
export function sessionInputSchemaForGrantsV2(grants: ReadonlySet<SessionCapability>) {
  return withAdvertisedJsonSchema(
    acceptedSessionInputV2,
    standardSchemaWithJson(advertisedSessionInputSchemaV2(grants)),
  )
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
    ...(input.branchScope === undefined ? {} : { branchScope: input.branchScope }),
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

function validateInteractionResponseField(input: SessionToolInputV2) {
  if (
    (input.operation === 'request-respond' || input.operation === 'approval-respond') &&
    input.interactionResponse === undefined
  ) {
    throw new Error(`interactionResponse is required for ${input.operation}.`)
  }
}

export function buildMcpSessionPayloadV2(input: SessionToolInputV2) {
  const parsed = parsedInput(input)
  validateInteractionResponseField(input)
  const payload =
    input.operation === 'export'
      ? buildMcpSessionExportPayloadV2(input)
      : buildSessionsCliPayload(parsed.command, parsed.arguments, {
          structured: mcpSessionStructuredInputV2(input),
        })
  validateParsedInput(input, parsed)
  return payload
}
