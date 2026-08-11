import type {
  McpCapabilityCatalog,
  McpJsonValue,
  McpPromptResult,
  McpResourceResult,
  McpTaskOperationInput,
  McpTaskRecord,
  McpTurnSnapshot,
  McpTurnSnapshotServer,
} from '@shared/types/mcp'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import {
  appDescriptor,
  promptDescriptor,
  resourceDescriptor,
  templateDescriptor,
} from './capability-descriptors'
import { mcpRemoteSkillDescriptor } from './remote-skills'
import { remoteTaskSchemaHash } from './remote-task-records'
import type { McpRuntimeState } from './runtime-state'
import type { McpClientConnection } from './types'

function isObject(value: McpJsonValue | undefined): value is Record<string, McpJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function values(value: McpJsonValue, key: string) {
  return isObject(value) && Array.isArray(value[key]) ? value[key] : []
}

async function browseServer(input: {
  readonly state: McpRuntimeState
  readonly snapshot: McpTurnSnapshot
  readonly server: McpTurnSnapshotServer
}) {
  const { connection } = await input.state.getConnectionForServer(
    input.snapshot,
    input.server.instanceId,
  )
  const has = (family: (typeof connection.capabilities)[number]) =>
    connection.capabilities.includes(family)
  const [prompts, resources, templates, tasks, tools, skills] = await Promise.all([
    has('prompts') ? connection.listPrompts() : null,
    has('resources') ? connection.listResources() : null,
    has('resources') ? connection.listResourceTemplates() : null,
    has('tasks') ? connection.listTasks() : null,
    has('tools')
      ? input.state.loadCatalog(
          input.snapshot,
          (server) => server.instanceId === input.server.instanceId,
        )
      : [],
    has('skills') ? connection.listSkills() : null,
  ])
  const taskRecords = tasks
    ? await input.state.recordRemoteTasks({
        snapshot: input.snapshot,
        server: input.server,
        connection,
        tasks: values(tasks, 'tasks'),
      })
    : []
  return {
    instructions: connection.instructions
      ? [
          {
            serverInstanceId: input.server.instanceId,
            serverLabel: input.server.name,
            instructions: connection.instructions,
            truncated: connection.instructionsTruncated === true,
          },
        ]
      : [],
    prompts: prompts
      ? values(prompts, 'prompts').flatMap((value) => {
          const descriptor = promptDescriptor(value, input.server)
          return descriptor ? [descriptor] : []
        })
      : [],
    resources: resources
      ? values(resources, 'resources').flatMap((value) => {
          const descriptor = resourceDescriptor(value, input.server)
          return descriptor ? [descriptor] : []
        })
      : [],
    resourceTemplates: templates
      ? values(templates, 'resourceTemplates').flatMap((value) => {
          const descriptor = templateDescriptor(value, input.server)
          return descriptor ? [descriptor] : []
        })
      : [],
    apps: tools.flatMap((tool) => {
      const descriptor = appDescriptor(tool)
      return descriptor ? [descriptor] : []
    }),
    tasks: taskRecords,
    skills: skills
      ? values(skills, 'skills').flatMap((value) => {
          const descriptor = mcpRemoteSkillDescriptor(
            value,
            input.server,
            connection.skillExtension?.directoryRead === true,
          )
          return descriptor ? [descriptor] : []
        })
      : [],
  } satisfies McpCapabilityCatalog
}

export async function browseMcpCapabilities(
  state: McpRuntimeState,
  snapshot: McpTurnSnapshot,
  serverInstanceId?: string,
) {
  const servers = serverInstanceId
    ? snapshot.servers.filter((server) => server.instanceId === serverInstanceId)
    : snapshot.servers
  if (serverInstanceId && servers.length === 0) {
    throw new Error('The requested MCP server is not enabled in this turn snapshot.')
  }
  const settled = await Promise.allSettled(
    servers.map((server) => browseServer({ state, snapshot, server })),
  )
  const catalogs: McpCapabilityCatalog[] = []
  for (const [index, result] of settled.entries()) {
    const server = servers[index]
    if (!server) continue
    if (result.status === 'fulfilled') {
      catalogs.push(result.value)
      state.removeNotice(
        resolveMcpRuntimeNamespace(snapshot),
        `runtime:${server.instanceId}:capabilities`,
      )
      continue
    }
    const detail = result.reason instanceof Error ? result.reason.message : String(result.reason)
    state.addNotice(resolveMcpRuntimeNamespace(snapshot), {
      id: `runtime:${server.instanceId}:capabilities`,
      severity: server.definition.required ? 'error' : 'warning',
      title: `${server.name} MCP capabilities could not be loaded`,
      detail,
      action: 'Review the server health and configuration, then refresh MCP capabilities.',
      serverInstanceId: server.instanceId,
    })
    if (server.definition.required) {
      throw new Error(`Required MCP server ${server.name} capabilities failed: ${detail}`)
    }
  }
  return {
    instructions: catalogs.flatMap((catalog) => catalog.instructions),
    prompts: catalogs.flatMap((catalog) => catalog.prompts),
    resources: catalogs.flatMap((catalog) => catalog.resources),
    resourceTemplates: catalogs.flatMap((catalog) => catalog.resourceTemplates),
    apps: catalogs.flatMap((catalog) => catalog.apps),
    tasks: catalogs.flatMap((catalog) => catalog.tasks),
    skills: catalogs.flatMap((catalog) => catalog.skills),
  } satisfies McpCapabilityCatalog
}

function attribution(server: McpTurnSnapshotServer) {
  return { serverInstanceId: server.instanceId, serverLabel: server.name }
}

export async function getMcpPrompt(input: {
  readonly state: McpRuntimeState
  readonly snapshot: McpTurnSnapshot
  readonly serverInstanceId: string
  readonly name: string
  readonly arguments?: Readonly<Record<string, string>>
}): Promise<McpPromptResult> {
  const { server, connection } = await input.state.getConnectionForServer(
    input.snapshot,
    input.serverInstanceId,
  )
  const result = await connection.getPrompt({ name: input.name, arguments: input.arguments })
  return {
    ...(isObject(result) && typeof result.description === 'string'
      ? { description: result.description }
      : {}),
    messages: isObject(result) && result.messages !== undefined ? result.messages : result,
    attribution: attribution(server),
  }
}

export async function readMcpResource(input: {
  readonly state: McpRuntimeState
  readonly snapshot: McpTurnSnapshot
  readonly serverInstanceId: string
  readonly uri: string
}): Promise<McpResourceResult> {
  const { server, connection } = await input.state.getConnectionForServer(
    input.snapshot,
    input.serverInstanceId,
  )
  const result = await connection.readResource({ uri: input.uri })
  return {
    contents: isObject(result) && result.contents !== undefined ? result.contents : result,
    attribution: attribution(server),
  }
}

async function operateStoredMcpTask(state: McpRuntimeState, input: McpTaskOperationInput) {
  const stored = await state.listRemoteTasks({
    projectPath: input.projectPath,
    serverInstanceId: input.serverInstanceId,
  })
  if (input.operation === 'list') return stored.map((task) => ({ ...task, disabled: true }))
  const taskId = input.taskId?.trim()
  if (!taskId) throw new Error(`${input.operation} requires taskId.`)
  const selected = stored.filter((task) => task.remoteTaskId === taskId || task.id === taskId)
  if (input.operation === 'get') return selected.map((task) => ({ ...task, disabled: true }))
  throw new Error(
    'This MCP server is disabled. The remote task may still be running; re-enable the server before requesting cancellation.',
  )
}

async function assertCurrentTaskIdentity(input: {
  readonly state: McpRuntimeState
  readonly snapshot: McpTurnSnapshot
  readonly server: McpTurnSnapshotServer
  readonly connection: McpClientConnection
  readonly taskId: string
}) {
  const stored = await input.state.listRemoteTasks({
    projectPath: input.snapshot.projectPath,
    sessionId: input.snapshot.sessionId,
    serverInstanceId: input.server.instanceId,
  })
  const selected = stored.filter(
    (task) => task.id === input.taskId || task.remoteTaskId === input.taskId,
  )
  const current = selected.filter(
    (task) =>
      task.configHash === input.server.configHash &&
      task.protocolVersion === input.connection.negotiatedProtocolVersion &&
      task.schemaHash === remoteTaskSchemaHash(input.connection),
  )
  if (selected.length > 0 && current.length === 0) {
    throw new Error(
      'This MCP Task belongs to an earlier server configuration or protocol. Re-open the original configuration instead of sending its id to the current server.',
    )
  }
}

async function requestTaskOperation(
  connection: McpClientConnection,
  operation: McpTaskOperationInput['operation'],
  taskId: string | undefined,
) {
  if (operation === 'list') return connection.listTasks()
  if (operation === 'get') return connection.getTask({ taskId: taskId ?? '' })
  return connection.cancelTask({ taskId: taskId ?? '' })
}

export async function operateMcpTask(
  state: McpRuntimeState,
  snapshot: McpTurnSnapshot | null,
  input: McpTaskOperationInput,
): Promise<readonly McpTaskRecord[]> {
  if (!snapshot) return operateStoredMcpTask(state, input)
  const { server, connection } = await state.getConnectionForServer(
    snapshot,
    input.serverInstanceId,
  )
  const taskId = input.taskId?.trim()
  if (input.operation !== 'list' && !taskId) throw new Error(`${input.operation} requires taskId.`)
  if (taskId) {
    await assertCurrentTaskIdentity({
      state,
      snapshot,
      server,
      connection,
      taskId,
    })
  }
  const result = await requestTaskOperation(connection, input.operation, taskId)
  const tasks = input.operation === 'list' ? values(result, 'tasks') : [result]
  return state.recordRemoteTasks({ snapshot, server, connection, tasks })
}
