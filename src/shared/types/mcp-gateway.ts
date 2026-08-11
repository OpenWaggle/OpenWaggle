import type { McpCapabilityFamily, McpJsonValue } from './mcp'

export type McpGatewayOperation = 'list' | 'search' | 'describe' | 'call'

export interface McpGatewayInput {
  readonly operation: McpGatewayOperation
  readonly query?: string
  readonly handle?: string
  readonly arguments?: McpJsonValue
}

export interface McpToolDescriptor {
  readonly handle: string
  readonly title: string
  readonly description?: string
  readonly serverLabel?: string
  readonly inputSchema?: McpJsonValue
  readonly outputSchema?: McpJsonValue
  readonly annotations?: McpJsonValue
}

export interface McpDirectToolDescriptor {
  readonly modelName: string
  readonly handle: string
  readonly title: string
  readonly description?: string
  readonly inputSchema?: McpJsonValue
  readonly serverLabel: string
}

export interface McpAppDescriptor {
  readonly serverInstanceId: string
  readonly serverLabel: string
  readonly toolHandle: string
  readonly toolName: string
  readonly toolTitle: string
  readonly resourceUri: string
  readonly allowedNetworkDomains: readonly string[]
}

export interface McpGatewayResult {
  readonly operation: McpGatewayOperation
  readonly text: string
  readonly tools?: readonly McpToolDescriptor[]
  readonly result?: McpJsonValue
  readonly isError?: boolean
  readonly attribution?: {
    readonly serverInstanceId: string
    readonly serverLabel: string
    readonly toolName: string
  }
  readonly app?: {
    readonly descriptor: McpAppDescriptor
    readonly toolResult: {
      readonly content: McpJsonValue
      readonly structuredContent?: McpJsonValue
      readonly isError: boolean
    }
  }
}

export interface McpCatalogSnapshot {
  readonly revision: string
  readonly serverInstanceId: string
  readonly negotiatedProtocolVersion: string
  readonly tools: readonly McpToolDescriptor[]
  readonly capabilities: readonly McpCapabilityFamily[]
  readonly serverClaim?: {
    readonly name: string
    readonly version: string
  }
}
