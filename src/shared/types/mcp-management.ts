export interface McpSecretSummary {
  readonly name: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface McpSetSecretInput {
  readonly name: string
  readonly value: string
}

export interface McpRemoveSecretInput {
  readonly name: string
}
