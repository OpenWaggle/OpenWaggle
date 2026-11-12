import { isMatching, P } from '@diegogbrisa/ts-match'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { HIVE_TOOL_NAME } from '@shared/constants/hive'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import type { SessionCapability } from '@shared/types/session-capability'
import { isRecord } from '@shared/utils/validation'
import type { AgentDefinitionProjectResolver } from '../../agent-definition-project'
import { createLogger } from '../../logger'
import { sessionCommandFailureMessage } from '../../session-host/session-command-failure-message'
import { executeSessionToolCommand } from '../../session-host/session-tool-gateway'
import { describeError } from '../../utils/describe-error'
import {
  agentDefinitionProjectForTool,
  isAgentDefinitionAction,
  queryAgentDefinitionsForTool,
  spawnAgentHint,
} from './sessions-tool-agent-definition-actions'
import { authorizeAttachments, authorizeExport } from './sessions-tool-authorization'
import {
  assertSessionsToolActionPermitted,
  permittedSessionsToolVariants,
  type SessionsToolActionGrant,
  sessionsToolSchemaForGrant,
} from './sessions-tool-capability-schema'
import { parseSessionsToolActionArguments } from './sessions-tool-flat-schema'
import {
  sessionsToolEssentialGuidelines,
  sessionsToolPromptGuidelines,
} from './sessions-tool-guidelines'
import { hiveHelp } from './sessions-tool-help'
import { HIVE_HELP_ACTION } from './sessions-tool-hot-schema'
import { buildSessionsToolPayload } from './sessions-tool-payload'
import { hiveResultText } from './sessions-tool-result'
import { executeScheduleToolAction } from './sessions-tool-schedule-approval'
import { isSessionsToolScheduleAction } from './sessions-tool-schedule-payload'
import { scheduledTasksToolResult } from './sessions-tool-schedule-result'
import { resolveSessionsToolSessionLinks } from './sessions-tool-session-links'
import type { SynchronousExtensionFactory } from './synchronous-extension-factory'

const logger = createLogger('hive-tool')

interface SessionsToolExtensionInput {
  readonly sessionId: string
  readonly runId: string
  readonly workingDirectory: string
  readonly projectPath?: string
  readonly agentDefinitionToggles?: Readonly<Record<string, boolean>>
  readonly sessionCapabilities?: readonly SessionCapability[]
  readonly modelMultiAgentEnabled?: boolean
  /** The Session scratch directory, where a result too large for the model is saved whole. */
  readonly scratchDirectory?: string
  /** Maps an agent-definition projectPath to its project and toggles; replaced in tests. */
  readonly resolveAgentDefinitionProject?: AgentDefinitionProjectResolver
}

export { queryAgentDefinitionsForTool } from './sessions-tool-agent-definition-actions'
export { buildSessionsToolPayload } from './sessions-tool-payload'

function sendSessionsToolCommand(
  input: SessionsToolExtensionInput,
  payload: LocalSessionCommandPayload,
  signal?: AbortSignal,
) {
  return executeSessionToolCommand({
    sourceSessionId: input.sessionId,
    sourceRunId: input.runId,
    workingDirectory: input.workingDirectory,
    ...(input.projectPath === undefined ? {} : { projectPath: input.projectPath }),
    payload,
    ...(signal ? { signal } : {}),
  })
}

function withoutVerbose(params: unknown) {
  if (!isRecord(params)) return params
  const { verbose: _verbose, ...rest } = params
  return rest
}

function helpResult(rawParams: unknown, grant: SessionsToolActionGrant) {
  const help = hiveHelp({
    variants: permittedSessionsToolVariants(grant),
    guidelines: sessionsToolPromptGuidelines(grant.capabilities, grant.modelMultiAgentEnabled),
    topic: isMatching({ topic: P._ }, rawParams) ? rawParams.topic : undefined,
  })
  return { content: [{ type: 'text' as const, text: help.text }], details: help.details }
}

async function executeSessionsToolCall(
  rawParams: unknown,
  input: SessionsToolExtensionInput,
  grant: SessionsToolActionGrant,
  ctx: ExtensionContext,
  toolCallId: string,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new Error('aborted')
  // `verbose` asks for the result envelope and item metadata; it is no action's parameter.
  const verbose = isMatching({ verbose: true }, rawParams)
  const params = resolveSessionsToolSessionLinks(
    parseSessionsToolActionArguments(withoutVerbose(rawParams)),
  )
  const successfulToolResult = async (result: unknown) => ({
    content: [
      {
        type: 'text' as const,
        text: await hiveResultText({
          result,
          verbose,
          toolCallId,
          ...(input.scratchDirectory ? { scratchDirectory: input.scratchDirectory } : {}),
        }),
      },
    ],
    details: result,
  })
  if (isAgentDefinitionAction(params)) {
    const project = await agentDefinitionProjectForTool(params, input, grant, (payload) =>
      sendSessionsToolCommand(input, payload, signal),
    )
    return successfulToolResult(
      await queryAgentDefinitionsForTool(params, project.projectPath, project.enabledByName),
    )
  }
  if (isSessionsToolScheduleAction(params)) {
    const result = await executeScheduleToolAction({
      params,
      source: { ...input, toolCallId },
      ctx,
      send: (payload) => sendSessionsToolCommand(input, payload, signal),
      ...(signal ? { signal } : {}),
    })
    return result.contract === 'scheduled-tasks-v1'
      ? scheduledTasksToolResult(result)
      : successfulToolResult(result)
  }
  const initialPayload = buildSessionsToolPayload(params, input)
  await authorizeAttachments(initialPayload, ctx, signal)
  const payload = await authorizeExport(initialPayload, input, ctx, signal)
  const result = await sendSessionsToolCommand(input, payload, signal)
  // The hint reads nothing for a failed spawn, and a hint that fails is no hint: it never turns
  // a spawn that succeeded into a tool error, so it can run beside the result.
  const [toolResult, hint] = await Promise.all([
    successfulToolResult(result),
    spawnAgentHint(params, result, input).catch((error: unknown) => {
      logger.warn('Spawn agent hint failed', { error: describeError(error) })
      return undefined
    }),
  ])
  return hint
    ? { ...toolResult, content: [...toolResult.content, { type: 'text' as const, text: hint }] }
    : toolResult
}

function failedToolResult(error: unknown) {
  const message = sessionCommandFailureMessage(error)
  // The result text leaves out Host context such as paths in a cause; the log keeps all of it.
  logger.warn('Hive tool command failed', { message, error: describeError(error) })
  return {
    content: [{ type: 'text' as const, text: message }],
    details: undefined,
    isError: true,
  }
}

const HIVE_TOOL_DESCRIPTION =
  'Coordinate your Hive of durable OpenWaggle Sessions: spawn Workers, read and wait on Sessions, report peer context, send Follow-ups, steer or interrupt a Run, review Delegations, manage Scheduled tasks. The Hive root is the Queen Session; every descendant is a Worker, an ordinary Session with its own transcript that may continue after this Run. Session summaries and Delegations carry nextActor: user, parent, worker, or none.'

export function createSessionsToolExtension(input: SessionsToolExtensionInput) {
  const grant: SessionsToolActionGrant = {
    capabilities: input.sessionCapabilities,
    modelMultiAgentEnabled: input.modelMultiAgentEnabled ?? true,
  }
  const factory: SynchronousExtensionFactory = (pi) => {
    // sessionsToolSchemaForGrant returns a plain TSchema, so arguments stay unknown until
    // parseSessionsToolActionArguments.
    pi.registerTool({
      name: HIVE_TOOL_NAME,
      label: 'Hive',
      description: HIVE_TOOL_DESCRIPTION,
      promptSnippet:
        'Use hive to spawn and coordinate durable Worker Sessions when parallel or delegated work is useful.',
      promptGuidelines: sessionsToolEssentialGuidelines(
        input.sessionCapabilities,
        grant.modelMultiAgentEnabled,
      ),
      parameters: sessionsToolSchemaForGrant(grant),
      // Runs before schema validation, so an action outside the grant is refused by name.
      prepareArguments: (args) => {
        assertSessionsToolActionPermitted(args, grant)
        return args
      },
      executionMode: 'sequential',
      async execute(toolCallId, params, signal, _onUpdate, ctx) {
        try {
          if (isMatching({ action: HIVE_HELP_ACTION }, params)) return helpResult(params, grant)
          return await executeSessionsToolCall(params, input, grant, ctx, toolCallId, signal)
        } catch (error) {
          return failedToolResult(error)
        }
      },
    })
  }
  return factory
}
