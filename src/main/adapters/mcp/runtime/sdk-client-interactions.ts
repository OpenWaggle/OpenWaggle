import { basename, isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Client, ClientCapabilities } from '@modelcontextprotocol/client'
import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import type { McpJsonValue, McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import type {
  McpElicitationResult,
  McpRuntimeInteractions,
  McpSamplingResult,
} from '../../../ports/mcp-runtime-service'

interface InteractionController {
  readonly capabilities: ClientCapabilities
  run<T>(interactions: McpRuntimeInteractions | undefined, operation: () => Promise<T>): Promise<T>
}

class InteractionSlot {
  private active: McpRuntimeInteractions | undefined
  private tail: Promise<void> = Promise.resolve()

  current(capability: string) {
    if (!this.active) {
      throw new Error(
        `MCP ${capability} requires a fresh user review, but no trusted interaction UI is available.`,
      )
    }
    return this.active
  }

  async run<T>(interactions: McpRuntimeInteractions | undefined, operation: () => Promise<T>) {
    const previous = this.tail
    const release = Promise.withResolvers<void>()
    this.tail = previous.then(() => release.promise)
    await previous
    this.active = interactions
    try {
      return await operation()
    } finally {
      this.active = undefined
      release.resolve()
    }
  }
}

function toJsonValue(value: unknown): McpJsonValue {
  const serialized = JSON.stringify(value)
  return decodeUnknownOrThrow(
    mcpConfigValueSchema,
    serialized === undefined ? null : JSON.parse(serialized),
  )
}

function effectiveRoots(snapshot: McpTurnSnapshot, server: McpTurnSnapshotServer) {
  const executionPath = snapshot.executionPath ?? snapshot.projectPath
  const paths = new Set(
    server.permissions.readRoots.map((root) =>
      isAbsolute(root) ? resolve(root) : resolve(executionPath, root),
    ),
  )
  return [...paths].map((path) => ({ uri: pathToFileURL(path).href, name: basename(path) || path }))
}

function elicitationCapabilities(server: McpTurnSnapshotServer): ClientCapabilities['elicitation'] {
  const mode = server.definition.clientCapabilities?.elicitation ?? 'form'
  if (mode === false) return undefined
  return mode === 'form-and-url' ? { form: { applyDefaults: true }, url: {} } : { form: {} }
}

function clientCapabilities(server: McpTurnSnapshotServer): ClientCapabilities {
  const elicitation = elicitationCapabilities(server)
  return {
    ...(elicitation ? { elicitation } : {}),
    ...(server.definition.clientCapabilities?.sampling === true ? { sampling: { tools: {} } } : {}),
    ...(server.definition.clientCapabilities?.roots === false ? {} : { roots: {} }),
  }
}

function registerElicitationHandler(input: {
  readonly client: Client
  readonly server: McpTurnSnapshotServer
  readonly slot: InteractionSlot
}) {
  if (!elicitationCapabilities(input.server)) return
  input.client.setRequestHandler('elicitation/create', async (request) => {
    const interactions = input.slot.current('elicitation')
    const result: McpElicitationResult = await interactions.elicit({
      serverInstanceId: input.server.instanceId,
      serverLabel: input.server.name,
      request: toJsonValue(request.params),
    })
    return {
      action: result.action,
      ...(result.content ? { content: { ...result.content } } : {}),
    }
  })
}

function registerSamplingHandler(input: {
  readonly client: Client
  readonly server: McpTurnSnapshotServer
  readonly slot: InteractionSlot
}) {
  if (input.server.definition.clientCapabilities?.sampling !== true) return
  input.client.setRequestHandler('sampling/createMessage', async (request) => {
    const interactions = input.slot.current('legacy sampling')
    const result: McpSamplingResult = await interactions.sample({
      serverInstanceId: input.server.instanceId,
      serverLabel: input.server.name,
      request: toJsonValue(request.params),
    })
    const content = Array.isArray(result.content)
      ? result.content.map((item) => ({ ...item }))
      : { ...result.content }
    return {
      model: result.model,
      role: result.role,
      content,
      ...(result.stopReason ? { stopReason: result.stopReason } : {}),
    }
  })
}

function registerRootsHandler(input: {
  readonly client: Client
  readonly snapshot: McpTurnSnapshot
  readonly server: McpTurnSnapshotServer
}) {
  if (input.server.definition.clientCapabilities?.roots === false) return
  const roots = effectiveRoots(input.snapshot, input.server)
  input.client.setRequestHandler('roots/list', async () => ({ roots }))
}

export function createMcpInteractionController(input: {
  readonly client: Client
  readonly snapshot: McpTurnSnapshot
  readonly server: McpTurnSnapshotServer
}): InteractionController {
  const slot = new InteractionSlot()
  const capabilities = clientCapabilities(input.server)
  input.client.registerCapabilities(capabilities)
  registerElicitationHandler({ client: input.client, server: input.server, slot })
  registerSamplingHandler({ client: input.client, server: input.server, slot })
  registerRootsHandler(input)
  return {
    capabilities,
    run: (interactions, operation) => slot.run(interactions, operation),
  }
}
