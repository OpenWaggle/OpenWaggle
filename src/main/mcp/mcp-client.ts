import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { DOUBLE_FACTOR } from '@shared/constants/constants'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import type { McpConnectionStatus, McpServerConfig, McpToolInfo } from '@shared/types/mcp'
import { getSafeChildEnvEntries } from '../env'
import { createLogger } from '../logger'

const logger = createLogger('mcp-client')

const CONNECT_TIMEOUT_MS = 30_000
const TOOL_CALL_TIMEOUT_MS = 60_000
const MAX_RECONNECT_RETRIES = 5
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

interface McpClientEvents {
  onStatusChange: (status: McpConnectionStatus, error?: string) => void
  onToolsChanged: () => void
}

export class McpClient {
  private client: Client | null = null
  private transport:
    | StdioClientTransport
    | SSEClientTransport
    | StreamableHTTPClientTransport
    | null = null
  private tools: McpToolInfo[] = []
  private _status: McpConnectionStatus = 'disconnected'
  private _error: string | undefined
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionalDisconnect = false

  constructor(
    readonly config: McpServerConfig,
    private readonly events: McpClientEvents,
  ) {}

  get status(): McpConnectionStatus {
    return this._status
  }

  get error(): string | undefined {
    return this._error
  }

  get toolList(): readonly McpToolInfo[] {
    return this.tools
  }

  async connect(): Promise<void> {
    if (this._status === 'connected' || this._status === 'connecting') return

    this.intentionalDisconnect = false
    this.setStatus('connecting')

    try {
      this.client = new Client({
        name: 'openwaggle',
        version: '1.0.0',
      })

      this.transport = this.createTransport()

      // Listen for tool list changes
      this.client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        await this.refreshTools()
        this.events.onToolsChanged()
      })

      // Connect with timeout
      const connectPromise = this.client.connect(this.transport)
      let connectTimer: ReturnType<typeof setTimeout> | null = null
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        connectTimer = setTimeout(
          () => reject(new Error('Connection timed out')),
          CONNECT_TIMEOUT_MS,
        )
      })
      try {
        await Promise.race([connectPromise, timeoutPromise])
      } finally {
        if (connectTimer) clearTimeout(connectTimer)
      }

      // For stdio transports, listen for process exit
      if (this.transport instanceof StdioClientTransport) {
        this.transport.onclose = () => {
          if (!this.intentionalDisconnect && this._status === 'connected') {
            logger.warn('stdio process exited unexpectedly', { server: this.config.name })
            this.setStatus('error', 'Server process exited unexpectedly')
            void this.attemptReconnect()
          }
        }
        this.transport.onerror = (err) => {
          logger.error('stdio transport error', {
            server: this.config.name,
            error: err.message,
          })
        }
      }

      await this.refreshTools()
      this.reconnectAttempts = 0
      this.setStatus('connected')
      logger.info('connected', { server: this.config.name, tools: this.tools.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('connection failed', { server: this.config.name, error: message })
      this.setStatus('error', message)
      await this.cleanup()
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true
    this.clearReconnectTimer()
    await this.cleanup()
    this.tools = []
    this.setStatus('disconnected')
    logger.info('disconnected', { server: this.config.name })
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client || this._status !== 'connected') {
      throw new Error(`MCP server "${this.config.name}" is not connected`)
    }

    const callPromise = this.client.callTool({ name, arguments: args })
    let callTimer: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      callTimer = setTimeout(
        () => reject(new Error(`Tool call "${name}" timed out after ${TOOL_CALL_TIMEOUT_MS}ms`)),
        TOOL_CALL_TIMEOUT_MS,
      )
    })

    let result: Awaited<ReturnType<Client['callTool']>>
    try {
      result = await Promise.race([callPromise, timeoutPromise])
    } finally {
      if (callTimer) clearTimeout(callTimer)
    }

    if (result.isError) {
      const errorText = extractTextContent(result.content)
      throw new Error(`Tool "${name}" failed: ${errorText}`)
    }

    return extractTextContent(result.content)
  }

  private async refreshTools(): Promise<void> {
    if (!this.client) return

    const response = await this.client.listTools()
    this.tools = response.tools.map((tool) => ({
      serverName: this.config.name,
      name: tool.name,
      namespacedName: `${sanitizeServerName(this.config.name)}__${tool.name}`,
      description: tool.description ?? '',
      inputSchema: parseInputSchema(tool.inputSchema),
    }))
  }

  private createTransport():
    | StdioClientTransport
    | SSEClientTransport
    | StreamableHTTPClientTransport {
    if (this.config.transport === 'stdio') {
      if (!this.config.command) {
        throw new Error('stdio transport requires a command')
      }
      const env: Record<string, string> | undefined = this.config.env
        ? buildStdioEnv(this.config.env)
        : undefined

      return new StdioClientTransport({
        command: this.config.command,
        args: this.config.args ? [...this.config.args] : [],
        env,
      })
    }

    if (!this.config.url) {
      throw new Error('http transport requires a URL')
    }

    // Try StreamableHTTP first (MCP 2025-03-26+), fall back to SSE
    return new StreamableHTTPClientTransport(new URL(this.config.url))
  }

  private async attemptReconnect(): Promise<void> {
    if (this.intentionalDisconnect || this.reconnectAttempts >= MAX_RECONNECT_RETRIES) {
      if (this.reconnectAttempts >= MAX_RECONNECT_RETRIES) {
        logger.warn('max reconnect attempts reached', { server: this.config.name })
      }
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(
      RECONNECT_BASE_MS * DOUBLE_FACTOR ** (this.reconnectAttempts - 1),
      RECONNECT_MAX_MS,
    )

    logger.info('scheduling reconnect', {
      server: this.config.name,
      attempt: this.reconnectAttempts,
      delayMs: delay,
    })

    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      void this.connect()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private async cleanup(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close()
      }
    } catch {
      // Ignore cleanup errors
    }
    this.client = null
    this.transport = null
  }

  private setStatus(status: McpConnectionStatus, error?: string): void {
    this._status = status
    this._error = error
    this.events.onStatusChange(status, error)
  }
}

/** Merge parent process env with user env overrides */
function buildStdioEnv(userEnv: Readonly<Record<string, string>>): Record<string, string> {
  const base = getSafeChildEnvEntries()
  for (const [key, value] of Object.entries(userEnv)) {
    base[key] = value
  }
  return base
}

function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
}

const inputSchemaValidator = Schema.Record({ key: Schema.String, value: Schema.Unknown })

function parseInputSchema(schema: unknown): Record<string, unknown> {
  const result = safeDecodeUnknown(inputSchemaValidator, schema)
  return result.success ? result.data : {}
}

const mcpContentPartSchema = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
})

function extractTextContent(content: unknown): string {
  if (!Array.isArray(content)) return String(content)

  const parts: string[] = []
  for (const part of content) {
    const parsed = safeDecodeUnknown(mcpContentPartSchema, part)
    if (parsed.success && parsed.data.type === 'text' && parsed.data.text !== undefined) {
      parts.push(parsed.data.text)
    }
  }
  return parts.join('\n') || JSON.stringify(content)
}
