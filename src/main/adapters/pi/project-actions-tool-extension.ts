import { createHash } from 'node:crypto'
import { match } from '@diegogbrisa/ts-match'
import type { ExtensionContext, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { ACTION_DEFINITION_LIMITS } from '@shared/types/action-definitions'
import { isActiveActionRun } from '@shared/types/action-runs'
import { SessionId } from '@shared/types/brand'
import { actionExecutionKey } from '@shared/utils/action-execution-key'
import * as Effect from 'effect/Effect'
import { type Static, Type } from 'typebox'
import { Check, Errors } from 'typebox/value'
import type { ActionCatalogServiceShape } from '../../ports/action-catalog-service'
import type { ActionRunServiceShape, ActionRunWorkspace } from '../../ports/action-run-service'
import type { SessionWorkspaceResourceRepositoryShape } from '../../ports/session-workspace-resource-repository'
import { getOpenWaggleAuthorize } from './agent-kernel/openwaggle-authorize-channel'

const identifier = Type.String({ minLength: 1, maxLength: ACTION_DEFINITION_LIMITS.ID_LENGTH })
const parameterVariants = [
  Type.Object({ action: Type.Literal('list') }),
  Type.Object({ action: Type.Literal('discover') }),
  Type.Object({ action: Type.Literal('runs') }),
  Type.Object({
    action: Type.Literal('start'),
    actionId: identifier,
    restartRunId: Type.Optional(identifier),
  }),
  Type.Object({
    action: Type.Literal('output'),
    runId: identifier,
    afterOffset: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
  Type.Object({ action: Type.Literal('stop'), runId: identifier }),
] as const
type ProjectActionParameters = Static<(typeof parameterVariants)[number]>

// Providers that emit `{}` for a root-level anyOf can accept a single object with
// action alternatives. Required fields for each action are checked before execution.
const parameters = Type.Unsafe<ProjectActionParameters>({
  type: 'object',
  properties: {
    action: Type.Union(parameterVariants.map((variant) => variant.properties.action)),
    actionId: Type.Optional(identifier),
    restartRunId: Type.Optional(identifier),
    runId: Type.Optional(identifier),
    afterOffset: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  required: ['action'],
})

function assertProjectActionArguments(params: unknown): asserts params is ProjectActionParameters {
  if (!Check(parameters, params)) {
    const details = [...Errors(parameters, params)]
      .map((error) => `${error.instancePath || 'arguments'}: ${error.message}`)
      .join('; ')
    throw new Error(`Invalid project_actions arguments: ${details}`)
  }
  const action = params.action
  const variant = parameterVariants.find(
    (candidate) => candidate.properties.action.const === action,
  )
  if (variant === undefined) throw new Error(`Unknown project_actions action "${action}".`)
  if (Check(variant, params)) return
  const details = [...Errors(variant, params)]
    .map((error) => `${error.instancePath || 'arguments'}: ${error.message}`)
    .join('; ')
  throw new Error(`Invalid project_actions arguments for "${action}": ${details}`)
}
export interface ProjectActionToolServices {
  readonly catalog: ActionCatalogServiceShape
  readonly runs: ActionRunServiceShape
  readonly workspaces: Pick<SessionWorkspaceResourceRepositoryShape, 'getBound'>
}
interface ProjectActionToolInput extends ProjectActionToolServices {
  readonly sessionId: string
  readonly runId: string
}

async function authorize(
  ctx: ExtensionContext,
  operation: 'start' | 'restart' | 'stop',
  execution: string,
  signal?: AbortSignal,
) {
  if (!ctx.hasUI) throw new Error('Action execution requires an OpenWaggle authorization context.')
  const title = `Allow action ${operation}?`
  const message = execution
  const channel = getOpenWaggleAuthorize(ctx.ui)
  const approved = channel
    ? await channel({
        title,
        message,
        scopeKey: {
          requesterId: 'openwaggle:project-actions',
          requester: 'Project Actions',
          capability: operation === 'stop' ? 'actions.stop' : 'actions.execute',
          resource: createHash('sha256').update(execution).digest('hex'),
        },
        ...(signal ? { signal } : {}),
      })
    : await ctx.ui.confirm(title, message, { signal })
  if (!approved) throw new Error('The action was not authorized.')
}

async function startAction(
  input: ProjectActionToolInput,
  workspace: ActionRunWorkspace,
  params: Extract<Static<typeof parameters>, { action: 'start' }>,
  requestId: string,
  ctx: ExtensionContext,
  signal?: AbortSignal,
) {
  if (!params.restartRunId) {
    const runs = await Effect.runPromise(input.runs.list(workspace.workspaceId))
    const active = runs.find(
      (run) =>
        run.action.id === params.actionId && isActiveActionRun(run) && !run.action.allowConcurrent,
    )
    // Returning a running snapshot is read-only, including after its saved definition was removed.
    if (active)
      return Effect.runPromise(
        input.runs.start({
          workspace,
          actionId: params.actionId,
          requestId,
          reuseRunId: active.id,
        }),
      )
  }
  const catalog = await Effect.runPromise(input.catalog.read(workspace))
  const definition = catalog.actions.find(
    (entry) => entry.definition.id === params.actionId,
  )?.definition
  if (!definition) throw new Error('Saved action not found. Use list to inspect available actions.')
  const executionKey = actionExecutionKey(definition)
  await authorize(
    ctx,
    params.restartRunId ? 'restart' : 'start',
    `${workspace.workspacePath}\n${executionKey}`,
    signal,
  )
  signal?.throwIfAborted()
  return Effect.runPromise(
    input.runs.start({
      workspace,
      actionId: params.actionId,
      requestId,
      expectedExecutionKey: executionKey,
      ...(params.restartRunId ? { restartRunId: params.restartRunId } : {}),
    }),
  )
}

async function execute(
  input: ProjectActionToolInput,
  params: Static<typeof parameters>,
  requestId: string,
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted()
  assertProjectActionArguments(params)
  const bound = await Effect.runPromise(input.workspaces.getBound(SessionId(input.sessionId)))
  if (!bound) throw new Error('The Session no longer has an active Workspace.')
  const workspace = {
    workspaceId: bound.id,
    sessionId: input.sessionId,
    projectPath: bound.projectPath,
    workspacePath: bound.workingPath,
  }
  return match(params)
    .with({ action: 'list' }, () => Effect.runPromise(input.catalog.read(workspace)))
    .with({ action: 'discover' }, () =>
      Effect.runPromise(input.catalog.discover(workspace.workspacePath)),
    )
    .with({ action: 'runs' }, () => Effect.runPromise(input.runs.list(workspace.workspaceId)))
    .with({ action: 'output' }, ({ runId, afterOffset }) =>
      Effect.runPromise(input.runs.output(workspace.workspaceId, runId, afterOffset ?? 0)),
    )
    .with({ action: 'start' }, (start) =>
      startAction(input, workspace, start, requestId, ctx, signal),
    )
    .with({ action: 'stop' }, async ({ runId }) => {
      await authorize(ctx, 'stop', `${workspace.workspacePath}\n${runId}`, signal)
      signal?.throwIfAborted()
      return Effect.runPromise(input.runs.stop(workspace.workspaceId, runId))
    })
    .exhaustive()
}

export function createProjectActionsToolExtension(input: ProjectActionToolInput): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: 'project_actions',
      label: 'Project Actions',
      description:
        'List saved project actions and discovered tasks; start, inspect, read output, or stop managed runs in this Session’s Workspace. These are the same executions shown in the Session Hub. Repeated starts reuse the active run unless finite-task concurrency was explicitly enabled. Restart is explicit. Output reads never launch a process.',
      parameters,
      executionMode: 'sequential',
      async execute(toolCallId, params, signal, _onUpdate, ctx) {
        try {
          const requestId = createHash('sha256')
            .update(`${input.runId}:${toolCallId}`)
            .digest('hex')
          const result = await execute(input, params, requestId, ctx, signal)
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result }
        } catch (error) {
          return {
            content: [
              { type: 'text', text: error instanceof Error ? error.message : String(error) },
            ],
            details: null,
            isError: true,
          }
        }
      },
    })
  }
}
