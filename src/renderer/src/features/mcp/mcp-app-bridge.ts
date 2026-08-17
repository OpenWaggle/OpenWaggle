import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
import {
  CallToolResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ReadResourceResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import type { McpAppDescriptor, McpAppToolCallResult, McpJsonValue } from '@shared/types/mcp'
import { useEffect } from 'react'
import { setComposerTextValue } from '@/features/chat/lib'
import { useComposerStore } from '@/features/composer/state'
import { api } from '@/shared/lib/ipc'
import type { ParsedMcpAppResource } from './mcp-app-resource'

const JSON_INDENT_SPACES = 2
const MAX_FRAME_HEIGHT = 800

function jsonValue(value: unknown): McpJsonValue {
  const serialized = JSON.stringify(value)
  return decodeUnknownOrThrow(
    mcpConfigValueSchema,
    serialized === undefined ? null : JSON.parse(serialized),
  )
}

function textFromContent(value: McpJsonValue) {
  if (!Array.isArray(value)) return JSON.stringify(value, null, JSON_INDENT_SPACES)
  const text = value.flatMap((entry) => {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      !Array.isArray(entry) &&
      entry.type === 'text' &&
      typeof entry.text === 'string'
    ) {
      return [entry.text]
    }
    return []
  })
  return text.length > 0 ? text.join('\n\n') : JSON.stringify(value, null, JSON_INDENT_SPACES)
}

function appendToComposerDraft(message: string) {
  const currentDraft = useComposerStore.getState().input
  const separator = currentDraft.length === 0 ? '' : currentDraft.endsWith('\n') ? '\n' : '\n\n'
  setComposerTextValue(`${currentDraft}${separator}${message}`)
}

function appToolResult(value: McpAppToolCallResult) {
  return CallToolResultSchema.parse({
    content: value.content,
    ...(value.structuredContent === undefined
      ? {}
      : { structuredContent: value.structuredContent }),
    isError: value.isError,
  })
}

interface McpAppBridgeInput {
  readonly contentWindow: Window
  readonly descriptor: McpAppDescriptor
  readonly projectPath: string | null
  readonly sessionId: string | null
  readonly initialArguments: Readonly<Record<string, McpJsonValue>>
  readonly initialResult?: McpAppToolCallResult
  readonly resource: ParsedMcpAppResource
  readonly onHeightChange: (height: number) => void
  readonly onStagedContext: (value: unknown) => void
  readonly onClose: () => void
}

async function confirmToolCall(input: McpAppBridgeInput, name: string, arguments_: unknown) {
  return api.showConfirm(
    `Allow ${input.descriptor.toolTitle} to call an MCP tool?`,
    [
      `Server: ${input.descriptor.serverLabel}`,
      `Tool: ${name}`,
      `Arguments: ${JSON.stringify(arguments_, null, JSON_INDENT_SPACES)}`,
      '',
      'This approval applies only to this call from the sandboxed App.',
    ].join('\n'),
  )
}

function registerServerHandlers(bridge: AppBridge, input: McpAppBridgeInput) {
  const context = { projectPath: input.projectPath, sessionId: input.sessionId }
  bridge.oncalltool = async ({ name, arguments: arguments_ }) => {
    if (!(await confirmToolCall(input, name, arguments_))) {
      return CallToolResultSchema.parse({
        content: [{ type: 'text', text: 'The user denied this MCP App tool call.' }],
        isError: true,
      })
    }
    const argumentsValue = jsonValue(arguments_ ?? {})
    if (
      typeof argumentsValue !== 'object' ||
      argumentsValue === null ||
      Array.isArray(argumentsValue)
    ) {
      throw new Error('MCP App tool arguments must be a JSON object.')
    }
    return appToolResult(
      await api.callMcpAppTool({
        ...context,
        serverInstanceId: input.descriptor.serverInstanceId,
        toolName: name,
        arguments: argumentsValue,
      }),
    )
  }
  bridge.onreadresource = async ({ uri }) => {
    const result = await api.readMcpResource({
      ...context,
      serverInstanceId: input.descriptor.serverInstanceId,
      uri,
    })
    return ReadResourceResultSchema.parse({ contents: result.contents })
  }
  bridge.onlistresources = async () => {
    const catalog = await api.listMcpCapabilities({
      ...context,
      serverInstanceId: input.descriptor.serverInstanceId,
    })
    return ListResourcesResultSchema.parse({ resources: catalog.resources })
  }
  bridge.onlistprompts = async () => {
    const catalog = await api.listMcpCapabilities({
      ...context,
      serverInstanceId: input.descriptor.serverInstanceId,
    })
    return ListPromptsResultSchema.parse({ prompts: catalog.prompts })
  }
}

function registerHostHandlers(bridge: AppBridge, input: McpAppBridgeInput) {
  bridge.onmessage = async ({ content }) => {
    const message = `MCP App message from ${input.descriptor.serverLabel}\n\n${textFromContent(jsonValue(content))}`
    const confirmed = await api.showConfirm(
      'Add this untrusted MCP App message to your draft?',
      [
        message,
        '',
        'OpenWaggle will append this content to your current editable draft. It will not be sent automatically.',
      ].join('\n'),
    )
    if (confirmed) appendToComposerDraft(message)
    return {}
  }
  bridge.onupdatemodelcontext = async (value) => {
    input.onStagedContext(value)
    return {}
  }
  bridge.onopenlink = async ({ url }) => {
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol)) return { isError: true }
    const confirmed = await api.showConfirm(
      'Open link requested by an MCP App?',
      `${input.descriptor.serverLabel} requested:\n${parsed.toString()}`,
    )
    if (!confirmed) return { isError: true }
    await api.openExternal(parsed.toString())
    return {}
  }
}

function createBridge(input: McpAppBridgeInput) {
  const bridge = new AppBridge(
    null,
    { name: 'OpenWaggle', version: '1.0.0' },
    {
      openLinks: {},
      serverTools: {},
      serverResources: {},
      message: { text: {}, image: {}, resource: {}, resourceLink: {} },
      updateModelContext: {
        text: {},
        image: {},
        resource: {},
        resourceLink: {},
        structuredContent: {},
      },
      sandbox: { permissions: {}, csp: input.resource.csp },
    },
    {
      hostContext: {
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        displayMode: 'inline',
        availableDisplayModes: ['inline'],
        locale: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        platform: 'desktop',
        containerDimensions: { maxHeight: MAX_FRAME_HEIGHT },
      },
    },
  )
  registerServerHandlers(bridge, input)
  registerHostHandlers(bridge, input)
  bridge.addEventListener('sizechange', ({ height }) => {
    if (height !== undefined) input.onHeightChange(height)
  })
  bridge.addEventListener('requestteardown', input.onClose)
  bridge.addEventListener('initialized', () => {
    void bridge.sendToolInput({ arguments: input.initialArguments }).then(() => {
      if (input.initialResult) void bridge.sendToolResult(appToolResult(input.initialResult))
    })
  })
  return bridge
}

export function useMcpAppBridge(input: McpAppBridgeInput | null) {
  useEffect(() => {
    if (!input) return
    const bridge = createBridge(input)
    const transport = new PostMessageTransport(input.contentWindow, input.contentWindow)
    void bridge.connect(transport)
    return () => {
      void bridge.teardownResource({}).catch(() => undefined)
      void bridge.close()
    }
  }, [input])
}
