import { isMatching, P } from '@diegogbrisa/ts-match'
import type { ExtensionContext, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { HIVE_TOOL_NAME } from '@shared/constants/hive'
import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import type { SessionCapability } from '@shared/types/session-capability'
import { isRecord } from '@shared/utils/validation'
import type { TSchema } from 'typebox'
import { discoverAgentDefinitions } from '../../agents/agent-definition-discovery'
import { createLogger } from '../../logger'
import { sessionCommandFailureMessage } from '../../session-host/session-command-failure-message'
import { executeSessionToolCommand } from '../../session-host/session-tool-gateway'
import { describeError } from '../../utils/describe-error'
import { authorizeAttachments, authorizeExport } from './sessions-tool-authorization'
import {
  assertSessionsToolActionPermitted,
  permittedSessionsToolVariants,
  type SessionsToolActionGrant,
  sessionsToolSchemaForGrant,
} from './sessions-tool-capability-schema'
import { assertSessionsToolActionArguments } from './sessions-tool-flat-schema'
import {
  sessionsToolEssentialGuidelines,
  sessionsToolPromptGuidelines,
} from './sessions-tool-guidelines'
import { hiveHelp } from './sessions-tool-help'
import { HIVE_HELP_ACTION } from './sessions-tool-hot-schema'
import type { SessionsToolParameters } from './sessions-tool-parameters'
import { buildSessionsToolPayload } from './sessions-tool-payload'
import { hiveResultText } from './sessions-tool-result'
import { executeScheduleToolAction } from './sessions-tool-schedule-approval'
import { isSessionsToolScheduleAction } from './sessions-tool-schedule-payload'
import { scheduledTasksToolResult } from './sessions-tool-schedule-result'
import { resolveSessionsToolSessionLinks } from './sessions-tool-session-links'

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
}

export { buildSessionsToolPayload } from './sessions-tool-payload'

export function queryAgentDefinitionsForTool(
  input: Extract<
    SessionsToolParameters,
    { action: 'agent_definitions_list' | 'agent_definitions_search' }
  >,
  projectPath: string,
  enabledByName: Readonly<Record<string, boolean>> = {},
) {
  return discoverAgentDefinitions({
    projectPath,
    ...(input.action === 'agent_definitions_search' ? { query: input.query } : {}),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    enabledByName,
  })
}

function isAgentDefinitionAction(
  params: SessionsToolParameters,
): params is Extract<
  SessionsToolParameters,
  { action: 'agent_definitions_list' | 'agent_definitions_search' }
> {
  return params.action === 'agent_definitions_list' || params.action === 'agent_definitions_search'
}

function sendSessionsToolCommand(
  input: SessionsToolExtensionInput,
  payload: LocalSessionCommandPayload,
  signal?: AbortSignal,
): Promise<LocalSessionCommandResult> {
  return executeSessionToolCommand({
    sourceSessionId: input.sessionId,
    sourceRunId: input.runId,
    workingDirectory: input.workingDirectory,
    projectPath: input.projectPath,
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
  ctx: ExtensionContext,
  toolCallId: string,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new Error('aborted')
  // `verbose` asks for the whole result envelope; it is no action's parameter.
  const verbose = isMatching({ verbose: true }, rawParams)
  const callParams = withoutVerbose(rawParams)
  assertSessionsToolActionArguments(callParams)
  const params = resolveSessionsToolSessionLinks(callParams)
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
    return successfulToolResult(
      await queryAgentDefinitionsForTool(
        params,
        input.projectPath ?? input.workingDirectory,
        input.agentDefinitionToggles,
      ),
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
  return successfulToolResult(await sendSessionsToolCommand(input, payload, signal))
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

export function createSessionsToolExtension(input: SessionsToolExtensionInput): ExtensionFactory {
  const grant: SessionsToolActionGrant = {
    capabilities: input.sessionCapabilities,
    modelMultiAgentEnabled: input.modelMultiAgentEnabled ?? true,
  }
  return (pi) => {
    // Typed as a plain schema: arguments stay unknown until assertSessionsToolActionArguments.
    pi.registerTool<TSchema, unknown>({
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
          return await executeSessionsToolCall(params, input, ctx, toolCallId, signal)
        } catch (error) {
          return failedToolResult(error)
        }
      },
    })
  }
}
