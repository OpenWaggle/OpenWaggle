import { type Client, specTypeSchemas } from '@modelcontextprotocol/client'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'

function toJsonValue(value: unknown) {
  if (value === undefined) return null
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return null
  const parsed: unknown = JSON.parse(serialized)
  return decodeUnknownOrThrow(mcpConfigValueSchema, parsed)
}

function requestOptions(signal?: AbortSignal) {
  return {
    signal,
    timeout: MCP_CONFIG.REQUEST_TIMEOUT_MS,
    maxTotalTimeout: MCP_CONFIG.REQUEST_TIMEOUT_MS,
  }
}

function cacheOptions(signal?: AbortSignal) {
  return { ...requestOptions(signal), cacheMode: 'refresh' as const }
}

export function createMcpCapabilityMethods(client: Client) {
  return {
    async listPrompts(signal?: AbortSignal) {
      return toJsonValue(await client.listPrompts(undefined, cacheOptions(signal)))
    },
    async getPrompt(input: {
      readonly name: string
      readonly arguments?: Readonly<Record<string, string>>
      readonly signal?: AbortSignal
    }) {
      return toJsonValue(
        await client.getPrompt(
          { name: input.name, ...(input.arguments ? { arguments: { ...input.arguments } } : {}) },
          requestOptions(input.signal),
        ),
      )
    },
    async listResources(signal?: AbortSignal) {
      return toJsonValue(await client.listResources(undefined, cacheOptions(signal)))
    },
    async listResourceTemplates(signal?: AbortSignal) {
      return toJsonValue(await client.listResourceTemplates(undefined, cacheOptions(signal)))
    },
    async readResource(input: { readonly uri: string; readonly signal?: AbortSignal }) {
      return toJsonValue(await client.readResource({ uri: input.uri }, cacheOptions(input.signal)))
    },
    async listTasks(signal?: AbortSignal) {
      return toJsonValue(
        await client.request(
          { method: 'tasks/list', params: {} },
          specTypeSchemas.ListTasksResult,
          requestOptions(signal),
        ),
      )
    },
    async getTask(input: { readonly taskId: string; readonly signal?: AbortSignal }) {
      return toJsonValue(
        await client.request(
          { method: 'tasks/get', params: { taskId: input.taskId } },
          specTypeSchemas.GetTaskResult,
          requestOptions(input.signal),
        ),
      )
    },
    async cancelTask(input: { readonly taskId: string; readonly signal?: AbortSignal }) {
      return toJsonValue(
        await client.request(
          { method: 'tasks/cancel', params: { taskId: input.taskId } },
          specTypeSchemas.CancelTaskResult,
          requestOptions(input.signal),
        ),
      )
    },
  }
}
