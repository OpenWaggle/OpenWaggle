import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { ActionDefinition } from '@shared/types/action-definitions'
import { SessionId } from '@shared/types/brand'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { ActionRunServiceShape } from '../../../ports/action-run-service'
import { OPENWAGGLE_AUTHORIZE_KEY } from '../agent-kernel/openwaggle-authorize-channel'
import { createProjectActionsToolExtension } from '../project-actions-tool-extension'

const definition: ActionDefinition = {
  id: 'test',
  name: 'Test',
  icon: 'test',
  invocation: { type: 'command', command: 'pnpm test', directory: '.' },
  kind: 'task',
  allowConcurrent: false,
  autoOpenPreview: false,
}

/** Proposals are data only (ADR 0038): no authorization, save or launch. */
function registration() {
  let tool: ToolDefinition | undefined
  const authorize = vi.fn(async () => true)
  const start = vi.fn()
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
          id: 'workspace',
          projectPath: '/repo',
          workingPath: '/repo',
          kind: 'local',
          pending: false,
          worktreeBranch: null,
        }),
    },
    catalog: fromPartial({
      read: () =>
        Effect.succeed({
          revision: 'one',
          actions: [{ source: 'local', definition }],
          profiles: [],
          preparation: [],
        }),
    }),
    runs: fromPartial<ActionRunServiceShape>({ start }),
  })(
    fromPartial<ExtensionAPI>({
      registerTool: (registered: ToolDefinition) => {
        tool = registered
      },
    }),
  )
  if (!tool) throw new Error('Tool was not registered')
  return { tool, authorize, start, ctx }
}

describe('project_actions repair proposals', () => {
  it('declares the proposal fields in the flat provider-facing schema', () => {
    const { tool } = registration()
    const shape = fromAny<{ properties?: Record<string, unknown> }, unknown>(
      JSON.parse(JSON.stringify(tool.parameters)),
    )
    expect(shape.properties?.command).toBeDefined()
    expect(shape.properties?.directory).toBeDefined()
    expect(shape.properties?.reason).toBeDefined()
  })

  it('returns a Command repair proposal as data without authorizing, saving or launching', async () => {
    const { tool, authorize, start, ctx } = registration()
    const result = await tool.execute(
      'propose',
      {
        action: 'propose',
        actionId: 'test',
        command: ' pnpm dev --host ',
        reason: 'Bind all hosts.',
      },
      undefined,
      undefined,
      ctx,
    )
    expect(result).not.toMatchObject({ isError: true })
    expect(result.details).toEqual({
      type: 'command-repair-proposal',
      actionId: 'test',
      actionName: 'Test',
      current: { command: 'pnpm test', directory: '.' },
      proposed: { command: 'pnpm dev --host', directory: '.' },
      reason: 'Bind all hosts.',
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'a directory outside the project',
      params: { directory: '../other' },
      error: 'must be relative to the project',
    },
    {
      label: 'a missing command',
      params: { command: undefined },
      error: 'Invalid project_actions arguments',
    },
  ])('rejects $label', async ({ params, error }) => {
    const { tool, ctx } = registration()
    const result = await tool.execute(
      'propose-invalid',
      { action: 'propose', actionId: 'test', command: 'pnpm dev', reason: 'x', ...params },
      undefined,
      undefined,
      ctx,
    )
    expect(result).toMatchObject({ isError: true })
    expect(result.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining(error) }),
    ])
  })
})
