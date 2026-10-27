import { MCP_EXPOSURE_VALUES, type McpServerExposure } from '@shared/types/mcp-configuration'
import { type McpRuntimeExposure, openWaggleMcpExposure } from '@shared/utils/mcp-exposure'
import { McpCliUsageError } from './mcp-cli-usage-error'

/** What `--exposure` accepts. OpenWaggle runs `direct` as `codemode`, so it offers neither. */
export const MCP_CLI_EXPOSURE_VALUES = MCP_EXPOSURE_VALUES.filter(
  (exposure): exposure is McpRuntimeExposure => exposure !== 'direct',
)

export const MCP_CLI_DIRECT_EXPOSURE_MESSAGE =
  'OpenWaggle no longer offers --exposure direct: it runs direct servers as codemode, so their ' +
  'tool schemas stay out of every request (MCP App tools stay declared). Use --exposure codemode.'

/** `--exposure` as OpenWaggle writes it; `direct` is refused, not rewritten. */
export function mcpCliExposureOption(value: string | undefined): McpRuntimeExposure | undefined {
  if (value === undefined) return undefined
  if (value === 'direct') throw new McpCliUsageError(MCP_CLI_DIRECT_EXPOSURE_MESSAGE)
  const exposure = MCP_CLI_EXPOSURE_VALUES.find((candidate) => candidate === value)
  if (!exposure) {
    throw new McpCliUsageError(
      `--exposure must be one of ${MCP_CLI_EXPOSURE_VALUES.join(', ')}; got "${value}".`,
    )
  }
  return exposure
}

/**
 * The exposure a CLI report shows: the one OpenWaggle runs. A file that says `direct` is read as
 * it is and shown as `codemode`; the file is never rewritten.
 */
export function mcpCliShownExposure(exposure: McpServerExposure): McpRuntimeExposure {
  return openWaggleMcpExposure(exposure)
}
