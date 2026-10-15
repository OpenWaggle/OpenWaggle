import {
  AppBridge,
  type McpUiHostContext,
  PostMessageTransport,
} from '@modelcontextprotocol/ext-apps/app-bridge'
import {
  CallToolResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ReadResourceResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import type { McpAppDescriptor, McpAppToolCallResult, McpJsonValue } from '@shared/types/mcp'
import { useEffect, useRef } from 'react'
import { setComposerTextValue } from '@/features/chat/lib'
import { useComposerStore } from '@/features/composer/state'
import { formatDisplayPathsInText } from '@/shared/lib/display-path'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { mcpAppDraftText } from './mcp-app-draft-text'
import type { ParsedMcpAppResource } from './mcp-app-resource'

const JSON_INDENT_SPACES = 2
const logger = createRendererLogger('mcp-app')

function jsonValue(value: unknown): McpJsonValue {
  const serialized = JSON.stringify(value)
  return decodeUnknownOrThrow(
    mcpConfigValueSchema,
    serialized === undefined ? null : JSON.parse(serialized),
  )
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
  readonly maxHeight: number
  readonly onHeightChange: (height: number) => void
  /** The App finished its handshake: it runs, so it is not shown as starting any more. */
  readonly onInitialized: () => void
  readonly onStagedContext: (value: unknown) => void
  readonly onClose: () => void
}

/** What the App lays itself out for, which changes while it runs. */
export interface McpAppLayout {
  readonly theme: 'light' | 'dark'
  /** The frame's width in CSS pixels, once measured. */
  readonly width: number | null
}

/** The whole host context; the bridge replaces it on every change and sends what differs. */
function hostContext(layout: McpAppLayout, maxHeight: number): McpUiHostContext {
  return {
    theme: layout.theme,
    displayMode: 'inline',
    availableDisplayModes: ['inline'],
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: 'desktop',
    containerDimensions:
      layout.width === null ? { maxHeight } : { maxHeight, width: Math.round(layout.width) },
  }
}

async function confirmToolCall(input: McpAppBridgeInput, name: string, arguments_: unknown) {
  const displayArguments = formatDisplayPathsInText(
    JSON.stringify(arguments_, null, JSON_INDENT_SPACES),
    [input.projectPath],
  )
  return api.showConfirm(
    `Allow ${input.descriptor.toolTitle} to call an MCP tool?`,
    [
      `Server: ${input.descriptor.serverLabel}`,
      `Tool: ${name}`,
      `Arguments: ${displayArguments}`,
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
        serverConfigHash: input.descriptor.serverConfigHash,
        toolName: name,
        arguments: argumentsValue,
      }),
    )
  }
  bridge.onreadresource = async ({ uri }) => {
    const result = await api.readMcpResource({
      ...context,
      serverInstanceId: input.descriptor.serverInstanceId,
      serverConfigHash: input.descriptor.serverConfigHash,
      uri,
    })
    return ReadResourceResultSchema.parse({ contents: result.contents })
  }
  const catalog = () =>
    api.listMcpAppCatalog({
      ...context,
      serverInstanceId: input.descriptor.serverInstanceId,
      serverConfigHash: input.descriptor.serverConfigHash,
    })
  bridge.onlistresources = async () =>
    ListResourcesResultSchema.parse({ resources: (await catalog()).resources })
  bridge.onlistprompts = async () =>
    ListPromptsResultSchema.parse({ prompts: (await catalog()).prompts })
}

function registerHostHandlers(bridge: AppBridge, input: McpAppBridgeInput) {
  bridge.onmessage = async ({ content }) => {
    const message = `MCP App message from ${input.descriptor.serverLabel}\n\n${mcpAppDraftText(jsonValue(content))}`
    const displayMessage = formatDisplayPathsInText(message, [input.projectPath])
    const confirmed = await api.showConfirm(
      'Add this untrusted MCP App message to your draft?',
      [
        displayMessage,
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

function createBridge(input: McpAppBridgeInput, layout: McpAppLayout) {
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
      sandbox: {
        permissions: {},
        csp: {
          connectDomains: [...input.resource.csp.connectDomains],
          resourceDomains: [...input.resource.csp.resourceDomains],
          frameDomains: [...input.resource.csp.frameDomains],
          baseUriDomains: [...input.resource.csp.baseUriDomains],
        },
      },
    },
    { hostContext: hostContext(layout, input.maxHeight) },
  )
  registerServerHandlers(bridge, input)
  registerHostHandlers(bridge, input)
  bridge.addEventListener('sizechange', ({ height }) => {
    if (height !== undefined) input.onHeightChange(height)
  })
  bridge.addEventListener('requestteardown', input.onClose)
  bridge.addEventListener('initialized', () => {
    input.onInitialized()
    void bridge.sendToolInput({ arguments: input.initialArguments }).then(() => {
      if (input.initialResult) void bridge.sendToolResult(appToolResult(input.initialResult))
    })
  })
  return bridge
}

/**
 * Connects the App in `input`'s frame, once per frame. A change of `layout` (the panel is resized,
 * the theme changes) is sent to the running App as a host context change, so it lays its data out
 * again instead of being reloaded.
 */
export function useMcpAppBridge(input: McpAppBridgeInput | null, layout: McpAppLayout) {
  const bridgeRef = useRef<AppBridge | null>(null)
  const layoutRef = useRef(layout)
  const maxHeight = input?.maxHeight
  // Declared first, so a bridge created below starts from the current layout.
  useEffect(() => {
    layoutRef.current = layout
    if (maxHeight === undefined) return
    try {
      bridgeRef.current?.setHostContext(hostContext(layout, maxHeight))
    } catch (error) {
      // Expected while the bridge connects: the App gets the current context when it initializes.
      logger.debug('Host context not sent yet', { error: String(error) })
    }
  }, [layout, maxHeight])
  useEffect(() => {
    if (!input) return
    const bridge = createBridge(input, layoutRef.current)
    bridgeRef.current = bridge
    const transport = new PostMessageTransport(input.contentWindow, input.contentWindow)
    void bridge.connect(transport)
    return () => {
      if (bridgeRef.current === bridge) bridgeRef.current = null
      void bridge.teardownResource({}).catch(() => undefined)
      void bridge.close()
    }
  }, [input])
}
