import { createHash } from 'node:crypto'
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import { actionExecutionKey } from '@shared/utils/action-execution-key'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ActionRunServiceShape,
  StartManagedActionInput,
} from '../../../ports/action-run-service'
import { createManagedActionFixture } from '../../project-actions/__tests__/managed-action-runs.test-harness'
import { OPENWAGGLE_AUTHORIZE_KEY } from '../agent-kernel/openwaggle-authorize-channel'
import { createProjectActionsToolExtension } from '../project-actions-tool-extension'

describe('Pi project_actions shares GUI executions', () => {
  let fixture: Awaited<ReturnType<typeof createManagedActionFixture>>
  beforeEach(async () => {
    fixture = await createManagedActionFixture()
  })
  afterEach(async () => {
    await fixture.dispose()
  })

  function registration(approved: boolean) {
    let tool: ToolDefinition | undefined
    const authorize = vi.fn(async () => approved)
    const ctx = fromPartial<ExtensionContext>({
      hasUI: true,
      ui: Object.assign({ confirm: async () => false }, { [OPENWAGGLE_AUTHORIZE_KEY]: authorize }),
    })
    createProjectActionsToolExtension({
      sessionId: SessionId('session'),
      runId: 'agent-run',
      workspaces: {
        getBound: () =>
          Effect.succeed({
            id: fixture.workspace.workspaceId,
            projectPath: fixture.root,
            workingPath: fixture.root,
            kind: 'local',
            pending: false,
            worktreeBranch: null,
          }),
      },
      catalog: fromPartial({
        read: () =>
          Effect.succeed({
            revision: 'one',
            actions: [{ source: 'local', definition: fixture.definition }],
            profiles: [],
            preparation: [],
          }),
      }),
      runs: fromPartial<ActionRunServiceShape>({
        list: (workspaceId: string) => Effect.tryPromise(() => fixture.runs.list(workspaceId)),
        start: (input: StartManagedActionInput) =>
          Effect.tryPromise(() => fixture.runs.start(input)),
        output: (workspace: string, id: string, offset: number) =>
          Effect.tryPromise(() => fixture.runs.output(workspace, id, offset)),
        stop: (workspace: string, id: string) =>
          Effect.tryPromise(() => fixture.runs.stop(workspace, id)),
      }),
    })(
      fromPartial<ExtensionAPI>({
        registerTool: (registered: ToolDefinition) => {
          tool = registered
        },
      }),
    )
    if (!tool) throw new Error('Tool was not registered')
    return { tool, authorize, ctx }
  }

  it('registers a flat provider-facing object schema with action-specific fields', () => {
    const { tool } = registration(true)
    const shape = fromAny<
      {
        type?: string
        anyOf?: unknown[]
        required?: string[]
        properties?: Record<string, unknown>
      },
      unknown
    >(JSON.parse(JSON.stringify(tool.parameters)))

    expect(shape.type).toBe('object')
    expect(shape.anyOf).toBeUndefined()
    expect(shape.required).toEqual(['action'])
    expect(shape.properties?.action).toBeDefined()
    expect(shape.properties?.actionId).toBeDefined()
    expect(shape.properties?.restartRunId).toBeDefined()
    expect(shape.properties?.runId).toBeDefined()
    expect(shape.properties?.afterOffset).toBeDefined()
  })

  it.each([
    { label: 'missing action', params: {} },
    { label: 'unknown action', params: { action: 'unknown' } },
    { label: 'start without actionId', params: { action: 'start' } },
    { label: 'output without runId', params: { action: 'output' } },
    { label: 'stop without runId', params: { action: 'stop' } },
    {
      label: 'negative output offset',
      params: { action: 'output', runId: 'run', afterOffset: -1 },
    },
  ])('rejects $label before executing a project action', async ({ params }) => {
    const { tool, authorize, ctx } = registration(true)
    const result = await tool.execute('invalid', params, undefined, undefined, ctx)

    expect(result).toMatchObject({ isError: true })
    expect(result.content).toEqual([
      expect.objectContaining({
        text: expect.stringContaining('Invalid project_actions arguments'),
      }),
    ])
    expect(authorize).not.toHaveBeenCalled()
    expect(fixture.processes).toHaveLength(0)
  })

  it('agent and GUI start requests reuse one live service; output reads do not launch', async () => {
    const gui = await fixture.runs.start({
      workspace: fixture.workspace,
      actionId: 'test',
      requestId: 'gui',
    })
    fixture.processes[0]?.emit('shared output\n')
    const { tool, authorize, ctx } = registration(true)
    const result = await tool.execute(
      'call',
      { action: 'start', actionId: 'test' },
      undefined,
      undefined,
      ctx,
    )
    expect(result.details).toMatchObject({ id: gui.id })
    expect(fixture.processes).toHaveLength(1)
    expect(authorize).not.toHaveBeenCalled()
    const output = await tool.execute(
      'read',
      { action: 'output', runId: gui.id },
      undefined,
      undefined,
      ctx,
    )
    expect(output.details).toMatchObject({ output: 'shared output\n' })
    expect(fixture.processes).toHaveLength(1)
  })

  it('a saved action does not bypass a denied authorization', async () => {
    const { tool, ctx } = registration(false)
    const result = await tool.execute(
      'denied',
      { action: 'start', actionId: 'test' },
      undefined,
      undefined,
      ctx,
    )
    expect(result).toMatchObject({ isError: true })
    expect(fixture.processes).toHaveLength(0)
  })

  it('keeps absolute workspace paths out of start, restart and stop approvals', async () => {
    const { tool, authorize, ctx } = registration(true)
    const started = await tool.execute(
      'start-with-approval',
      { action: 'start', actionId: 'test' },
      undefined,
      undefined,
      ctx,
    )
    expect(started).not.toMatchObject({ isError: true })
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Session workspace: .'),
      }),
    )
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.not.stringContaining(fixture.root) }),
    )
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeKey: expect.objectContaining({
          resource: createHash('sha256')
            .update(`${fixture.root}\n${actionExecutionKey(fixture.definition)}`)
            .digest('hex'),
        }),
      }),
    )
    const run = fromAny<{ id: string }, unknown>(started.details)
    const restarted = await tool.execute(
      'restart-with-approval',
      { action: 'start', actionId: 'test', restartRunId: run.id },
      undefined,
      undefined,
      ctx,
    )
    expect(restarted).not.toMatchObject({ isError: true })
    expect(authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Allow action restart?',
        message: expect.not.stringContaining(fixture.root),
      }),
    )
    const restartedRun = fromAny<{ id: string }, unknown>(restarted.details)
    await tool.execute(
      'stop-with-approval',
      { action: 'stop', runId: restartedRun.id },
      undefined,
      undefined,
      ctx,
    )
    expect(authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.not.stringContaining(fixture.root),
        scopeKey: expect.objectContaining({
          resource: createHash('sha256')
            .update(`${fixture.root}\n${restartedRun.id}`)
            .digest('hex'),
        }),
      }),
    )
  })

  it.each([
    {
      field: 'command',
      change: { invocation: { type: 'command', command: 'changed', directory: '.' } },
    },
    { field: 'preview URL', change: { previewUrl: 'http://localhost:9000/private' } },
    { field: 'automatic preview', change: { autoOpenPreview: true } },
  ] as const)(
    'rejects $field edits while agent execution authorization was pending',
    async ({ change }) => {
      const { tool, authorize, ctx } = registration(true)
      authorize.mockImplementation(async () => {
        fixture.edit([
          {
            ...fixture.definition,
            ...change,
          },
        ])
        return true
      })
      const result = await tool.execute(
        'changed',
        { action: 'start', actionId: 'test' },
        undefined,
        undefined,
        ctx,
      )
      expect(result).toMatchObject({ isError: true })
      expect(fixture.processes).toHaveLength(0)
    },
  )
})
