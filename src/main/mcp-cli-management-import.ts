import { MCP_CONFIG } from '@shared/constants/mcp'
import type {
  McpImportApplyResultView,
  McpImportPreviewView,
} from '@shared/types/mcp-configuration-operations'
import {
  McpCliUsageError,
  mcpCliConflictPolicy,
  mcpCliImportSources,
} from './mcp-cli-management-arguments'
import {
  MCP_MANAGEMENT_EXIT,
  type McpManagementCommandInput,
  type McpManagementExit,
} from './mcp-cli-management-context'
import { projectOptionOf } from './mcp-cli-management-list'
import { vaultSecretLines } from './mcp-cli-management-registry'

/** `openwaggle mcp import`: previews other tools' servers, and with `--apply` imports them. */

function previewLines(preview: McpImportPreviewView) {
  const lines = preview.candidates.map(
    (candidate) =>
      `${candidate.source}: ${candidate.name} (${candidate.target}) ${candidate.status}\n  from ${candidate.sourcePath}${candidate.warnings.map((warning) => `\n  ${warning}`).join('')}`,
  )
  const errors = preview.errors.map((error) => `${error.source}: ${error.path}: ${error.message}`)
  return [...(lines.length > 0 ? lines : ['No MCP servers found in other tools.']), ...errors]
}

function chosenFingerprints(preview: McpImportPreviewView, names: readonly string[] | undefined) {
  if (!names) {
    return preview.candidates
      .filter((candidate) => candidate.status === 'new' || candidate.status === 'source-changed')
      .map((candidate) => candidate.fingerprint)
  }
  return names.map((name) => {
    const candidate = preview.candidates.find(
      (item) => item.name === name || item.targetName === name,
    )
    if (!candidate) throw new Error(`No server named "${name}" was found in other tools.`)
    return candidate.fingerprint
  })
}

/** Skipped servers that changed in the other app since they were imported, by source name. */
function skippedSourceChanges(
  preview: McpImportPreviewView,
  skipped: readonly { readonly fingerprint: string }[],
) {
  const skippedFingerprints = new Set(skipped.map((item) => item.fingerprint))
  return preview.candidates
    .filter(
      (candidate) =>
        candidate.status === 'source-changed' && skippedFingerprints.has(candidate.fingerprint),
    )
    .map((candidate) => candidate.name)
}

/** The project and tools of this command, as options the hints repeat. */
function sameImportOptions(
  input: McpManagementCommandInput,
  sources: readonly string[] | undefined,
) {
  const project = projectOptionOf({ args: input.args, projectPath: input.projectPath })
  return `${project}${sources ? ` --from ${sources.join(',')}` : ''}`
}

function printApplied(
  input: McpManagementCommandInput,
  preview: McpImportPreviewView,
  result: McpImportApplyResultView,
  sources: readonly string[] | undefined,
) {
  const { output } = input.context
  for (const item of result.imported) {
    output.log(`Imported ${item.source} server "${item.sourceName}" as "${item.targetName}".`)
  }
  for (const item of result.skipped) output.log(`Skipped: ${item.reason}`)
  for (const line of vaultSecretLines(result.secrets, result.existingSecrets)) output.log(line)
  const changed = skippedSourceChanges(preview, result.skipped)
  if (changed.length === 0 || mcpCliConflictPolicy(input.args) === 'replace') return
  const one = changed.length === 1
  const servers = changed.map((name) => ` --server ${name}`).join('')
  output.log(
    `${changed.join(', ')} changed in the other app since ${one ? 'it was' : 'they were'} imported. To update ${one ? 'it' : 'them'}, run: openwaggle mcp import${sameImportOptions(input, sources)} --apply --conflict replace${servers}`,
  )
}

export async function importCommand(input: McpManagementCommandInput): Promise<McpManagementExit> {
  const { args, projectPath, context } = input
  if (args.positional.length > 0) {
    throw new McpCliUsageError('Usage: openwaggle mcp import [--from <tools>] [--apply] [-l]')
  }
  const sources = mcpCliImportSources(args)
  const scopeRequest = { projectPath, ...(sources ? { sources } : {}) }
  const preview = await context.host.invoke('mcp:preview-imports', scopeRequest)
  const json = args.flags.has('json')
  if (!args.flags.has('apply')) {
    context.output.log(
      json
        ? JSON.stringify(preview, null, MCP_CONFIG.JSON_INDENT_SPACES)
        : previewLines(preview).join('\n'),
    )
    if (!json && preview.candidates.length > 0) {
      // The same project and tools, so applying imports what this preview listed.
      context.output.log(
        `Import them with: openwaggle mcp import${sameImportOptions(input, sources)} --apply [--server <name>]`,
      )
    }
    return MCP_MANAGEMENT_EXIT.SUCCESS
  }
  const fingerprints = chosenFingerprints(preview, args.lists.get('server'))
  if (fingerprints.length === 0) {
    context.output.log('Nothing to import.')
    return MCP_MANAGEMENT_EXIT.SUCCESS
  }
  const result = await context.host.invoke('mcp:apply-imports', {
    ...scopeRequest,
    fingerprints,
    target: projectPath ? 'project' : 'global',
    conflictPolicy: mcpCliConflictPolicy(args),
  })
  if (!json) {
    printApplied(input, preview, result, sources)
    return MCP_MANAGEMENT_EXIT.SUCCESS
  }
  context.output.log(
    JSON.stringify(
      {
        imported: result.imported,
        skipped: result.skipped,
        secrets: result.secrets,
        existingSecrets: result.existingSecrets,
      },
      null,
      MCP_CONFIG.JSON_INDENT_SPACES,
    ),
  )
  return MCP_MANAGEMENT_EXIT.SUCCESS
}
