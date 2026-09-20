import { MCP_CONFIG } from '@shared/constants/mcp'
import { ALL_IMPORT_SOURCES } from './adapters/mcp/import-adapters'

const MAX_STDIN_SECRET_BYTES = 1_000_000

export async function readSecretFromStdin() {
  if (process.stdin.isTTY)
    throw new Error('Secret input must be piped on stdin; values are never accepted as arguments.')
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

export function parseImportSources(value: string | undefined) {
  if (!value || value === 'all') return ALL_IMPORT_SOURCES
  const requested = value.split(',').map((entry) => entry.trim())
  const invalid = requested.filter(
    (entry) => !ALL_IMPORT_SOURCES.some((source) => source === entry),
  )
  if (invalid.length > 0) throw new Error(`Unsupported import sources: ${invalid.join(', ')}.`)
  return ALL_IMPORT_SOURCES.filter((source) => requested.includes(source))
}

export function formatMcpCliOutput(value: unknown, json: boolean) {
  return json
    ? JSON.stringify({ schemaVersion: 1, data: value }, null, MCP_CONFIG.JSON_INDENT_SPACES)
    : typeof value === 'string'
      ? value
      : JSON.stringify(value, null, MCP_CONFIG.JSON_INDENT_SPACES)
}
