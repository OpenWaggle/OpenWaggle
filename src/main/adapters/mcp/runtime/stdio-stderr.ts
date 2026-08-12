import type { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { createLogger } from '../../../logger'

const logger = createLogger('mcp-client')

export function createMcpStderrObserver(input: {
  readonly serverName: string
  readonly suppressContent: boolean
  readonly log?: (
    message: string,
    data: { readonly server: string; readonly message: string },
  ) => void
}) {
  let capturedBytes = 0
  let suppressionReported = false
  const writeLog = input.log ?? ((message, data) => logger.info(message, data))
  return (chunk: Buffer | string) => {
    if (input.suppressContent) {
      if (!suppressionReported) {
        suppressionReported = true
        writeLog('MCP server stderr', {
          server: input.serverName,
          message: '[content suppressed because vault secrets were injected]',
        })
      }
      return
    }
    if (capturedBytes >= MCP_CONFIG.MAX_STDERR_BYTES) return
    const text = chunk.toString()
    const remaining = MCP_CONFIG.MAX_STDERR_BYTES - capturedBytes
    const visible = Buffer.from(text).subarray(0, remaining).toString('utf8')
    capturedBytes += Buffer.byteLength(visible)
    writeLog('MCP server stderr', { server: input.serverName, message: visible.trimEnd() })
  }
}

export function monitorMcpStderr(
  transport: StdioClientTransport,
  serverName: string,
  suppressContent: boolean,
) {
  transport.stderr?.on('data', createMcpStderrObserver({ serverName, suppressContent }))
}
