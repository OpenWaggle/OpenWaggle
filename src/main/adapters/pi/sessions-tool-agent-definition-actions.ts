import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { isMatching } from '@diegogbrisa/ts-match'
import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import {
  type AgentDefinitionProjectResolver,
  resolveAgentDefinitionProject,
} from '../../agent-definition-project'
import {
  ALL_AGENT_DEFINITIONS,
  discoverAgentDefinitions,
} from '../../agents/agent-definition-discovery'
import { suggestAgentDefinition } from '../../domain/agents/agent-definition-suggestion'
import { createLogger } from '../../logger'
import { describeError } from '../../utils/describe-error'
import {
  permitsSessionsToolAction,
  type SessionsToolActionGrant,
} from './sessions-tool-capability-schema'
import type { SessionsToolParameters } from './sessions-tool-parameters'

const logger = createLogger('hive-tool')

export type AgentDefinitionToolParameters = Extract<
  SessionsToolParameters,
  { action: 'agent_definitions_list' | 'agent_definitions_search' }
>

export interface AgentDefinitionToolSource {
  readonly workingDirectory: string
  readonly projectPath?: string
  readonly agentDefinitionToggles?: Readonly<Record<string, boolean>>
  /** Maps an agent-definition projectPath to its project and toggles; replaced in tests. */
  readonly resolveAgentDefinitionProject?: AgentDefinitionProjectResolver
}

type SendSessionCommand = (
  payload: LocalSessionCommandPayload,
) => Promise<LocalSessionCommandResult>

export function isAgentDefinitionAction(
  params: SessionsToolParameters,
): params is AgentDefinitionToolParameters {
  return params.action === 'agent_definitions_list' || params.action === 'agent_definitions_search'
}

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
 * Asks the Session Host for one Session of the project, as `list` with `catalogScope: project`
 * does. The Host authorizes the project as a target of this caller, by the same scope rule as
 * launch and create (only a root Session whose Run reaches every project may name another one), so
 * its refusal (`target_scope_denied`) is the answer for a project outside the caller's scope, the
 * same whether the path is a project or not. A caller in scope learns whether it has Sessions.
 */
async function projectHasSessions(projectPath: string, send: SendSessionCommand) {
  const result = await send({
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: { operation: 'list', limit: 1, projectPath, archived: false },
    },
  })
  if (result.contract !== 'session-query-v2') return false
  const outcome = result.response.outcome
  return outcome.operation === 'list' && 'sessions' in outcome && outcome.sessions.length > 0
}

/**
 * The project and toggles an agent-definition action reads: the caller's own project, or the
 * project its projectPath names. Another project needs launch or create, the actions that start a
 * Session there with one of its definitions, the Host's authorization of that project as a target,
 * and a project OpenWaggle knows (opened by the user, or with a Session); a folder that is none of
 * these is refused, never read in its place.
 */
export async function agentDefinitionProjectForTool(
  params: AgentDefinitionToolParameters,
  source: AgentDefinitionToolSource,
  grant: SessionsToolActionGrant,
  send: SendSessionCommand,
) {
  const own = source.projectPath ?? source.workingDirectory
  const ownProject = { projectPath: own, enabledByName: source.agentDefinitionToggles ?? {} }
  const requested = params.projectPath
  if (requested === undefined) return ownProject
  if (!path.isAbsolute(requested)) {
    throw new Error(`${params.action} refused: projectPath must be an absolute project path.`)
  }
  const resolved = await (source.resolveAgentDefinitionProject ?? resolveAgentDefinitionProject)(
    requested,
  )
  if (await sameDirectory(resolved.projectPath, own)) return ownProject
  if (!permitsSessionsToolAction('launch', grant) && !permitsSessionsToolAction('create', grant)) {
    throw new Error(
      `capability_denied: ${params.action} for another project requires sessions:create, as launch and create there do; this Session reads only its own project's Agent definitions.`,
    )
  }
  const hasSessions = await projectHasSessions(resolved.projectPath, send)
  if (!resolved.known && !hasSessions) {
    throw new Error(
      `${params.action} refused: ${requested} is not a project in OpenWaggle. It is neither open in OpenWaggle nor has a Session there; ask the user to open it in OpenWaggle first.`,
    )
  }
  return { projectPath: resolved.projectPath, enabledByName: resolved.enabledByName }
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
export async function spawnAgentHint(
  params: SessionsToolParameters,
  result: LocalSessionCommandResult,
  source: AgentDefinitionToolSource,
) {
  if (params.action !== 'spawn' || params.agent !== undefined || !spawnedWorker(result)) {
    return undefined
  }
  const definitions = await discoverAgentDefinitions({
    projectPath: source.projectPath ?? source.workingDirectory,
    enabledByName: source.agentDefinitionToggles ?? {},
    limit: ALL_AGENT_DEFINITIONS,
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
