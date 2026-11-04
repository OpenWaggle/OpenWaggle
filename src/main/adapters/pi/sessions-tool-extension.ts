import { realpath } from 'node:fs/promises'
import path from 'node:path'
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
import {
  type AgentDefinitionProjectResolver,
  resolveAgentDefinitionProject,
} from '../../agent-definition-project'
import { discoverAgentDefinitions } from '../../agents/agent-definition-discovery'
import { suggestAgentDefinition } from '../../domain/agents/agent-definition-suggestion'
import { createLogger } from '../../logger'
import { sessionCommandFailureMessage } from '../../session-host/session-command-failure-message'
import { executeSessionToolCommand } from '../../session-host/session-tool-gateway'
import { describeError } from '../../utils/describe-error'
import { authorizeAttachments, authorizeExport } from './sessions-tool-authorization'
import {
  assertSessionsToolActionPermitted,
  permitsSessionsToolAction,
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
  /** Maps an agent-definition projectPath to its project and toggles; replaced in tests. */
  readonly resolveAgentDefinitionProject?: AgentDefinitionProjectResolver
}

export { buildSessionsToolPayload } from './sessions-tool-payload'

export function queryAgentDefinitionsForTool(
  input: AgentDefinitionToolParameters,
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

type AgentDefinitionToolParameters = Extract<
  SessionsToolParameters,
  { action: 'agent_definitions_list' | 'agent_definitions_search' }
>

/** Every spelling of a directory: as given, then its real path when a symlink makes them differ. */
async function directorySpellings(directory: string) {
  const given = path.resolve(directory)
  const real = await realpath(given).catch(() => given)
  return new Set([given, real])
}

async function sameDirectory(left: string, right: string) {
  const [leftSpellings, rightSpellings] = await Promise.all([
    directorySpellings(left),
    directorySpellings(right),
  ])
  return [...leftSpellings].some((spelling) => rightSpellings.has(spelling))
}

/**
 * The project and toggles an agent-definition action reads: the caller's own project, or the
 * project its projectPath names. Another project needs launch or create, the actions that start a
 * Session there with one of its definitions, and it must be a project the user opened in
 * OpenWaggle, as launch requires; a folder that is not one is refused, never read in its place.
 */
async function agentDefinitionProjectForTool(
  params: AgentDefinitionToolParameters,
  input: SessionsToolExtensionInput,
  grant: SessionsToolActionGrant,
) {
  const own = input.projectPath ?? input.workingDirectory
  const ownProject = { projectPath: own, enabledByName: input.agentDefinitionToggles ?? {} }
  const requested = params.projectPath
  if (requested === undefined) return ownProject
  if (!path.isAbsolute(requested)) {
    throw new Error(`${params.action} refused: projectPath must be an absolute project path.`)
  }
  const resolved = await (input.resolveAgentDefinitionProject ?? resolveAgentDefinitionProject)(
    requested,
  )
  if (await sameDirectory(resolved.projectPath, own)) return ownProject
  if (!permitsSessionsToolAction('launch', grant) && !permitsSessionsToolAction('create', grant)) {
    throw new Error(
      `${params.action} refused: this Session can read only its own project's Agent definitions; another project needs launch or create.`,
    )
  }
  if (!resolved.known) {
    throw new Error(
      `${params.action} refused: ${requested} is not a project in OpenWaggle. Pass the absolute path of a project as list with catalogScope all shows it.`,
    )
  }
  return { projectPath: resolved.projectPath, enabledByName: resolved.enabledByName }
}

function isAgentDefinitionAction(
  params: SessionsToolParameters,
): params is AgentDefinitionToolParameters {
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
    const project = await agentDefinitionProjectForTool(params, input, grant)
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
  const toolResult = await successfulToolResult(result)
  const hint = await spawnAgentHint(params, result, input)
  return hint
    ? { ...toolResult, content: [...toolResult.content, { type: 'text' as const, text: hint }] }
    : toolResult
}

function spawnedWorker(result: LocalSessionCommandResult) {
  return isMatching(
    { contract: 'session-lifecycle-v2', response: { outcome: { effect: 'spawned-worker' } } },
    result,
  )
}

/**
 * After a spawn without `agent` whose objective restates an Agent definition's role, a hint that
 * names the definition, so the next Worker in that role is spawned with it. It never blocks or
 * changes the spawn, and a catalog that cannot be read gives no hint.
 */
async function spawnAgentHint(
  params: SessionsToolParameters,
  result: LocalSessionCommandResult,
  input: SessionsToolExtensionInput,
) {
  if (params.action !== 'spawn' || params.agent !== undefined || !spawnedWorker(result)) {
    return undefined
  }
  const definitions = await discoverAgentDefinitions({
    projectPath: input.projectPath ?? input.workingDirectory,
    enabledByName: input.agentDefinitionToggles ?? {},
  }).then(
    (catalog) => catalog.definitions.filter((definition) => definition.valid),
    (error: unknown) => {
      logger.warn('Agent definitions could not be read for a spawn hint', {
        error: describeError(error),
      })
      return []
    },
  )
  const suggested = suggestAgentDefinition(
    { objective: params.objective, ...(params.title ? { title: params.title } : {}) },
    definitions,
  )
  if (!suggested) return undefined
  return `suggestedAgent: ${JSON.stringify(suggested.name)}. This objective describes the role of the Agent definition ${JSON.stringify(suggested.name)} (${JSON.stringify(suggested.description)}). If that is this Worker's role, spawn the next such Worker with agent: ${JSON.stringify(suggested.name)} and an objective that carries only its task.`
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
    // Typed as a plain schema: arguments stay unknown until parseSessionsToolActionArguments.
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
          return await executeSessionsToolCall(params, input, grant, ctx, toolCallId, signal)
        } catch (error) {
          return failedToolResult(error)
        }
      },
    })
  }
}
