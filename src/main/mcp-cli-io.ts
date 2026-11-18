import { MCP_CONFIG } from '@shared/constants/mcp'
import { sessionsCliResponseText } from './sessions-cli-output'

const MAX_STDIN_SECRET_BYTES = 1_000_000

export async function readSecretFromStdin() {
  if (process.stdin.isTTY) {
    throw new Error('Secret input must be piped on stdin; values are never accepted as arguments.')
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    total += buffer.byteLength
    if (total > MAX_STDIN_SECRET_BYTES) throw new Error('Secret input exceeded the safety limit.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/[\r\n]+$/, '')
}

/** Human-readable `openwaggle mcp` output. `--json` output goes through `mcpCliJsonResponse`. */
export function formatMcpCliOutput(value: unknown) {
  return typeof value === 'string'
    ? value
    : JSON.stringify(value, null, MCP_CONFIG.JSON_INDENT_SPACES)
}

/** The `openwaggle mcp` commands that answer `--json`, by their path after `mcp` (ADR 0063). */
export type McpCliJsonCommand =
  | 'list'
  | 'doctor'
  | 'import'
  | 'registry search'
  | 'registry get'
  | 'registry add'

/** `openwaggle mcp … --json` answers in the Hive CLI envelope, like every other command (#351). */
export function mcpCliJsonResponse(command: McpCliJsonCommand, value: unknown) {
  return sessionsCliResponseText(`mcp ${command}`, value, true).trimEnd()
}
