import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createMcpRuntimeService } from '../runtime/runtime-service-factory'
import { connection, server, snapshot } from './mcp-runtime-test-utils'

describe('first-party MCP capability runtime', () => {
  it('browses prompts, resources, tasks, and modern and legacy MCP App metadata', async () => {
    const client = connection({
      capabilities: ['tools', 'prompts', 'resources', 'tasks'],
      tools: [
        {
          name: 'modern_app',
          inputSchema: { type: 'object' },
          meta: { ui: { resourceUri: 'ui://apps/modern' } },
        },
        {
          name: 'legacy_app',
          inputSchema: { type: 'object' },
          meta: { 'ui/resourceUri': 'ui://apps/legacy' },
        },
      ],
      listPrompts: async () => ({
        prompts: [{ name: 'review', arguments: [{ name: 'focus', required: true }] }],
      }),
      listResources: async () => ({
        resources: [{ uri: 'docs://readme', name: 'README', mimeType: 'text/markdown' }],
      }),
      listResourceTemplates: async () => ({
        resourceTemplates: [{ uriTemplate: 'docs://{path}', name: 'Project document' }],
      }),
      listTasks: async () => ({ tasks: [{ taskId: 'task-1', status: 'working' }] }),
    })
    const service = createMcpRuntimeService({ connect: async () => client })

    const catalog = await service.browseCapabilities(snapshot())

    expect(catalog.prompts).toEqual([
      expect.objectContaining({ name: 'review', serverInstanceId: 'server-1' }),
    ])
    expect(catalog.resources).toEqual([
      expect.objectContaining({ uri: 'docs://readme', mimeType: 'text/markdown' }),
    ])
    expect(catalog.resourceTemplates).toEqual([
      expect.objectContaining({ uriTemplate: 'docs://{path}' }),
    ])
    expect(catalog.apps.map((app) => app.resourceUri)).toEqual([
      'ui://apps/modern',
      'ui://apps/legacy',
    ])
    expect(catalog.tasks).toEqual([
      expect.objectContaining({ task: { taskId: 'task-1', status: 'working' } }),
    ])
  })

  it('keeps server instructions lazy and verifies opted-in SEP-2640 Skills before review', async () => {
    const markdown = [
      '---',
      'name: safe-review',
      'description: Review a remote change safely',
      '---',
      '',
      'Inspect the change. Do not execute bundled scripts.',
    ].join('\n')
    const uri = 'skill://safe-review/SKILL.md'
    const digest = `sha256:${createHash('sha256').update(markdown).digest('hex')}`
    const skill = {
      uri,
      frontmatter: { name: 'safe-review', description: 'Review a remote change safely' },
      resources: [{ uri, digest }],
    }
    const service = createMcpRuntimeService({
      connect: async () =>
        connection({
          capabilities: ['skills'],
          instructions: 'Use skill://safe-review/SKILL.md when the user asks for a review.',
          skillExtension: { directoryRead: true },
          listSkills: async () => ({ skills: [skill] }),
          getSkill: async () => ({ skill }),
          readResource: async () => ({
            contents: [{ uri, mimeType: 'text/markdown', text: markdown }],
          }),
        }),
    })
    const turn = snapshot({
      servers: [
        server({
          definition: {
            command: 'remote-skills',
            clientCapabilities: { remoteSkills: true },
          },
        }),
      ],
    })

    const catalog = await service.browseCapabilities(turn)
    const review = await service.reviewRemoteSkill({
      snapshot: turn,
      serverInstanceId: 'server-1',
      uri,
    })

    expect(catalog.instructions).toEqual([
      expect.objectContaining({ serverLabel: 'private-docs-server', truncated: false }),
    ])
    expect(catalog.skills).toEqual([
      expect.objectContaining({ uri, integrity: 'content-bound', directoryRead: true }),
    ])
    expect(review).toMatchObject({ markdown, digestVerified: true })
  })

  it('rejects a remote Skill whose bytes do not match the advertised digest', async () => {
    const uri = 'skill://unsafe/SKILL.md'
    const skill = {
      uri,
      frontmatter: { name: 'unsafe', description: 'Unsafe content' },
      resources: [{ uri, digest: `sha256:${'0'.repeat(64)}` }],
    }
    const service = createMcpRuntimeService({
      connect: async () =>
        connection({
          capabilities: ['skills'],
          listSkills: async () => ({ skills: [skill] }),
          getSkill: async () => ({ skill }),
          readResource: async () => ({
            contents: [
              {
                uri,
                text: '---\nname: unsafe\ndescription: Unsafe content\n---\n\nRotated content',
              },
            ],
          }),
        }),
    })

    await expect(
      service.reviewRemoteSkill({
        snapshot: snapshot(),
        serverInstanceId: 'server-1',
        uri,
      }),
    ).rejects.toThrow('digest verification failed')
  })

  it('retains remote Tasks when MCP is disabled and reports that remote work may continue', async () => {
    const client = connection({
      capabilities: ['tasks'],
      listTasks: async () => ({ tasks: [{ taskId: 'task-durable', status: 'working' }] }),
    })
    const service = createMcpRuntimeService({ connect: async () => client, now: () => 42 })
    const turn = snapshot()

    const active = await service.operateTask(turn, {
      projectPath: turn.projectPath,
      sessionId: turn.sessionId,
      serverInstanceId: 'server-1',
      operation: 'list',
    })
    await service.completeTurn({ sessionId: turn.sessionId, nextSnapshot: null })
    const retained = await service.operateTask(null, {
      projectPath: turn.projectPath,
      sessionId: turn.sessionId,
      serverInstanceId: 'server-1',
      operation: 'list',
    })

    expect(active).toEqual([
      expect.objectContaining({
        remoteTaskId: 'task-durable',
        protocolVersion: '2026-07-28',
        configHash: 'config-1',
        disabled: false,
      }),
    ])
    expect(retained).toEqual([
      expect.objectContaining({ remoteTaskId: 'task-durable', disabled: true }),
    ])
    await expect(
      service.operateTask(null, {
        projectPath: turn.projectPath,
        sessionId: turn.sessionId,
        serverInstanceId: 'server-1',
        operation: 'cancel',
        taskId: 'task-durable',
      }),
    ).rejects.toThrow('remote task may still be running')
  })

  it('never dispatches a retained Task id to a changed server configuration', async () => {
    const client = connection({
      capabilities: ['tasks'],
      listTasks: async () => ({ tasks: [{ taskId: 'task-bound', status: 'working' }] }),
    })
    const service = createMcpRuntimeService({ connect: async () => client })
    const original = snapshot()
    await service.operateTask(original, {
      projectPath: original.projectPath,
      sessionId: original.sessionId,
      serverInstanceId: 'server-1',
      operation: 'list',
    })
    const changed = snapshot({
      id: 'snapshot-2',
      revision: 'revision-2',
      servers: [server({ configHash: 'config-2' })],
    })

    await expect(
      service.operateTask(changed, {
        projectPath: changed.projectPath,
        sessionId: changed.sessionId,
        serverInstanceId: 'server-1',
        operation: 'cancel',
        taskId: 'task-bound',
      }),
    ).rejects.toThrow('earlier server configuration or protocol')
  })

  it('keeps healthy capability catalogs when an optional server fails', async () => {
    const optional = server({ instanceId: 'optional', name: 'optional-server' })
    const healthy = server({ instanceId: 'healthy', name: 'healthy-server' })
    const service = createMcpRuntimeService({
      connect: async ({ server: selected }) => {
        if (selected.instanceId === 'optional') throw new Error('capability endpoint unavailable')
        return connection({
          capabilities: ['prompts'],
          listPrompts: async () => ({ prompts: [{ name: 'healthy-prompt' }] }),
        })
      },
    })
    const turn = snapshot({ servers: [optional, healthy] })

    const catalog = await service.browseCapabilities(turn)

    expect(catalog.prompts).toEqual([
      expect.objectContaining({ name: 'healthy-prompt', serverInstanceId: 'healthy' }),
    ])
    expect(await service.getNotices(turn.sessionId)).toEqual([
      expect.objectContaining({
        severity: 'warning',
        title: 'optional-server MCP capabilities could not be loaded',
        detail: 'capability endpoint unavailable',
      }),
    ])
  })
})
