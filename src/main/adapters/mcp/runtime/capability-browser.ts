import type {
  McpCapabilityCatalog,
  McpTurnSnapshot,
  McpTurnSnapshotServer,
} from '@shared/types/mcp'
import { Effect } from 'effect'
import { resolveMcpRuntimeNamespace } from '../../../domain/mcp/runtime-namespace'
import {
  McpRequiredServerUnavailable,
  type McpRuntimeFailure,
  McpServerNotEnabled,
} from '../../../ports/mcp-errors'
import {
  appDescriptor,
  promptDescriptor,
  resourceDescriptor,
  templateDescriptor,
} from './capability-descriptors'
import { fromConnection, values } from './capability-shared'
import { mcpRemoteSkillDescriptor } from './remote-skills'
import type { McpRuntimeStateService } from './runtime-state-types'

function browseServer(input: {
  readonly state: McpRuntimeStateService
  readonly snapshot: McpTurnSnapshot
  readonly server: McpTurnSnapshotServer
}): Effect.Effect<McpCapabilityCatalog, McpRuntimeFailure> {
  return Effect.gen(function* () {
    const { connection } = yield* input.state.getConnectionForServer(
      input.snapshot,
      input.server.instanceId,
    )
    const has = (family: (typeof connection.capabilities)[number]) =>
      connection.capabilities.includes(family)
    const [prompts, resources, templates, tasks, tools, skills] = yield* Effect.all(
      [
        has('prompts')
          ? fromConnection('listPrompts', () => connection.listPrompts())
          : Effect.succeed(null),
        has('resources')
          ? fromConnection('listResources', () => connection.listResources())
          : Effect.succeed(null),
        has('resources')
          ? fromConnection('listResourceTemplates', () => connection.listResourceTemplates())
          : Effect.succeed(null),
        has('tasks')
          ? fromConnection('listTasks', () => connection.listTasks())
          : Effect.succeed(null),
        has('tools')
          ? input.state.loadCatalog(
              input.snapshot,
              (server) => server.instanceId === input.server.instanceId,
            )
          : Effect.succeed([]),
        has('skills')
          ? fromConnection('listSkills', () => connection.listSkills())
          : Effect.succeed(null),
      ] as const,
      { concurrency: 'unbounded' },
    )
    const taskRecords = tasks
      ? yield* input.state.recordRemoteTasks({
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
  })
}

export function browseMcpCapabilities(
  state: McpRuntimeStateService,
  snapshot: McpTurnSnapshot,
  serverInstanceId?: string,
): Effect.Effect<McpCapabilityCatalog, McpRuntimeFailure> {
  return Effect.gen(function* () {
    const servers = serverInstanceId
      ? snapshot.servers.filter((server) => server.instanceId === serverInstanceId)
      : snapshot.servers
    if (serverInstanceId && servers.length === 0) {
      return yield* Effect.fail(
        new McpServerNotEnabled({
          serverInstanceId,
          message: 'The requested MCP server is not enabled in this turn snapshot.',
        }),
      )
    }
    const settled = yield* Effect.forEach(
      servers,
      (server) => Effect.either(browseServer({ state, snapshot, server })),
      { concurrency: 'unbounded' },
    )
    const namespace = resolveMcpRuntimeNamespace(snapshot)
    const catalogs: McpCapabilityCatalog[] = []
    for (const [index, result] of settled.entries()) {
      const server = servers[index]
      if (!server) continue
      if (result._tag === 'Right') {
        catalogs.push(result.right)
        yield* state.removeNotice(namespace, `runtime:${server.instanceId}:capabilities`)
        continue
      }
      const detail = result.left.message
      yield* state.addNotice(namespace, {
        id: `runtime:${server.instanceId}:capabilities`,
        severity: server.definition.required ? 'error' : 'warning',
        title: `${server.name} MCP capabilities could not be loaded`,
        detail,
        action: 'Review the server health and configuration, then refresh MCP capabilities.',
        serverInstanceId: server.instanceId,
      })
      if (server.definition.required) {
        return yield* Effect.fail(
          new McpRequiredServerUnavailable({
            serverInstanceId: server.instanceId,
            serverLabel: server.name,
            detail,
            message: `Required MCP server ${server.name} capabilities failed: ${detail}`,
          }),
        )
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
  })
}
