import { type Client, specTypeSchemas } from '@modelcontextprotocol/client'
import { MCP_CONFIG, MCP_LATEST_PROTOCOL_VERSION } from '@shared/constants/mcp'
import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import type { McpEventKind, McpJsonValue, McpLoggingLevel } from '@shared/types/mcp'

function toJsonValue(value: unknown): McpJsonValue {
  const serialized = JSON.stringify(value)
  return decodeUnknownOrThrow(
    mcpConfigValueSchema,
    serialized === undefined ? null : JSON.parse(serialized),
  )
}

function boundedJsonValue(value: unknown): McpJsonValue {
  const payload = toJsonValue(value)
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
  return bytes <= MCP_CONFIG.MAX_STDERR_BYTES
    ? payload
    : { truncated: true, bytes, detail: 'Server log payload exceeded the local safety limit.' }
}

const NOTIFICATIONS = [
  ['notifications/tools/list_changed', 'tools-list-changed'],
  ['notifications/prompts/list_changed', 'prompts-list-changed'],
  ['notifications/resources/list_changed', 'resources-list-changed'],
  ['notifications/resources/updated', 'resource-updated'],
] as const satisfies readonly (readonly [string, McpEventKind])[]

function installHandlers(
  client: Client,
  onEvent: (event: { readonly kind: McpEventKind; readonly payload: McpJsonValue }) => void,
) {
  for (const [method, kind] of NOTIFICATIONS) {
    client.setNotificationHandler(method, (notification) => {
      onEvent({ kind, payload: toJsonValue(notification.params ?? {}) })
    })
  }
  client.setNotificationHandler(
    'notifications/tasks/status',
    { params: specTypeSchemas.TaskStatusNotificationParams },
    (params) => onEvent({ kind: 'task-status', payload: toJsonValue(params) }),
  )
  client.setNotificationHandler('notifications/message', (notification) => {
    onEvent({ kind: 'server-log', payload: boundedJsonValue(notification.params ?? {}) })
  })
}

function removeHandlers(client: Client) {
  for (const [method] of NOTIFICATIONS) client.removeNotificationHandler(method)
  client.removeNotificationHandler('notifications/tasks/status')
  client.removeNotificationHandler('notifications/message')
}

export function createMcpEventMethods(
  client: Client,
  loggingLevel: McpLoggingLevel | 'off' | undefined,
) {
  return {
    async subscribeEvents(input: {
      readonly resourceUris: readonly string[]
      readonly onEvent: (event: {
        readonly kind: McpEventKind
        readonly payload: McpJsonValue
      }) => void
      readonly signal?: AbortSignal
    }) {
      installHandlers(client, input.onEvent)
      const options = {
        signal: input.signal,
        timeout: MCP_CONFIG.REQUEST_TIMEOUT_MS,
        maxTotalTimeout: MCP_CONFIG.REQUEST_TIMEOUT_MS,
      }
      if (client.getServerCapabilities()?.logging && loggingLevel !== 'off') {
        await client.request(
          {
            method: 'logging/setLevel',
            params: { level: (loggingLevel ?? 'info') satisfies McpLoggingLevel },
          },
          options,
        )
      }
      if (client.getNegotiatedProtocolVersion() === MCP_LATEST_PROTOCOL_VERSION) {
        const subscription = await client.listen(
          {
            toolsListChanged: true,
            promptsListChanged: true,
            resourcesListChanged: true,
            ...(input.resourceUris.length > 0
              ? { resourceSubscriptions: [...input.resourceUris] }
              : {}),
          },
          options,
        )
        return {
          mode: 'modern-listen' as const,
          resourceUris: subscription.honoredFilter.resourceSubscriptions ?? [],
          async close() {
            await subscription.close()
            removeHandlers(client)
          },
        }
      }
      await Promise.all(input.resourceUris.map((uri) => client.subscribeResource({ uri }, options)))
      return {
        mode: 'legacy-notifications' as const,
        resourceUris: input.resourceUris,
        async close() {
          await Promise.allSettled(
            input.resourceUris.map((uri) => client.unsubscribeResource({ uri }, options)),
          )
          removeHandlers(client)
        },
      }
    },
  }
}
