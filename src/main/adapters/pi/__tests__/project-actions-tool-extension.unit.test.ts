import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
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

  it('rejects edits made while agent execution authorization was pending', async () => {
    const { tool, authorize, ctx } = registration(true)
    authorize.mockImplementation(async () => {
      fixture.edit([
        {
          ...fixture.definition,
          invocation: { type: 'command', command: 'changed', directory: '.' },
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
  })
})
