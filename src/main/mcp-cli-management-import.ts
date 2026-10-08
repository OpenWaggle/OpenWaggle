import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpImportPreviewView } from '@shared/types/mcp-configuration-operations'
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

export async function importCommand({
  args,
  projectPath,
  context,
}: McpManagementCommandInput): Promise<McpManagementExit> {
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
      context.output.log('Import them with: openwaggle mcp import --apply [--server <name>]')
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
  if (json) {
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
  } else {
    for (const item of result.imported) {
      context.output.log(
        `Imported ${item.source} server "${item.sourceName}" as "${item.targetName}".`,
      )
    }
    for (const item of result.skipped) context.output.log(`Skipped: ${item.reason}`)
    for (const line of vaultSecretLines(result.secrets, result.existingSecrets)) {
      context.output.log(line)
    }
  }
  return MCP_MANAGEMENT_EXIT.SUCCESS
}
