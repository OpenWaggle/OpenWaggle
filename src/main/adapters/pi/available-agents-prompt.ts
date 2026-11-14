import { HIVE_TOOL_NAME } from '@shared/constants/hive'
import type { SessionCapability } from '@shared/types/session-capability'
import {
  ALL_AGENT_DEFINITIONS,
  discoverAgentDefinitions,
} from '../../agents/agent-definition-discovery'
import { agentToolAllowlist } from '../../domain/agents/agent-tool-allowlist'
import { createLogger } from '../../logger'
import { describeError } from '../../utils/describe-error'
import {
  permitsSessionsToolAction,
  type SessionsToolActionGrant,
} from './sessions-tool-capability-schema'
import type { SynchronousExtensionFactory } from './synchronous-extension-factory'

const logger = createLogger('available-agents')

/** Pi wraps a named section in a tag of the same name, as it renders `<available_skills>`. */
export const AVAILABLE_AGENTS_PROMPT_SECTION = 'available_agents'

/** The most definitions the prompt lists; agent_definitions_list finds the rest. */
export const AVAILABLE_AGENTS_PROMPT_LIMIT = 24

/** A description is cut to this many characters, at a word, so one long one cannot crowd out others. */
export const AVAILABLE_AGENT_DESCRIPTION_LIMIT = 280

/** Cut at the last word boundary that keeps at least this share of the limit. */
const WORD_BOUNDARY_MIN_SHARE = 0.6

export interface AvailableAgent {
  readonly name: string
  readonly description: string
}

function escapeXml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function shortDescription(description: string) {
  const flat = description.replace(/\s+/g, ' ').trim()
  // Counted and cut by code point, so a cut never splits a surrogate pair into a lone half.
  const codePoints = Array.from(flat)
  if (codePoints.length <= AVAILABLE_AGENT_DESCRIPTION_LIMIT) return flat
  const cut = codePoints.slice(0, AVAILABLE_AGENT_DESCRIPTION_LIMIT - 1).join('')
  const boundary = cut.lastIndexOf(' ')
  const kept =
    boundary >= AVAILABLE_AGENT_DESCRIPTION_LIMIT * WORD_BOUNDARY_MIN_SHARE
      ? cut.slice(0, boundary)
      : cut
  return `${kept.trimEnd()}…`
}

/** "spawn a Worker", "spawn a Worker or launch a root Session", "launch a root Session". */
function startPhrase(permits: (action: string) => boolean) {
  const starts = [
    ...(permits('spawn') ? ['spawn a Worker'] : []),
    ...(permits('launch') || permits('create')
      ? [`${permits('launch') ? 'launch' : 'create'} a root Session`]
      : []),
  ]
  return starts.join(' or ')
}

/**
 * The text names the task, not `objective`: create takes none, and an objective passed to it
 * would be dropped.
 *
 * The `available_agents` system prompt section: the project's enabled, valid Agent definitions,
 * names and descriptions only, for a Session that can start one. Without it, agents wrote each
 * role into the objective by hand and never passed `agent` (25 hand-written reviewer Workers in
 * one Hive, beside a `reviewer` definition). Undefined when there is nothing to list or the
 * Session cannot start a Session with a definition.
 */
export function availableAgentsPromptSection(
  agents: readonly AvailableAgent[],
  grant: SessionsToolActionGrant,
) {
  const permits = (action: string) => permitsSessionsToolAction(action, grant)
  const start = startPhrase(permits)
  if (agents.length === 0 || start === '') return undefined
  const listed = agents.slice(0, AVAILABLE_AGENTS_PROMPT_LIMIT)
  const more = agents.length > listed.length
  return [
    `Agent definitions of this project. When one fits a role, ${start} with agent: "<name>" instead of describing the role yourself: the new Session runs with the definition's instructions, model, tools, and workspace, so give it only the task, not the role.`,
    ...listed.map(
      (agent) =>
        `<agent name="${escapeXml(agent.name)}">${escapeXml(shortDescription(agent.description))}</agent>`,
    ),
    ...(more
      ? ['More are defined: agent_definitions_list and agent_definitions_search find them.']
      : []),
  ].join('\n')
}

export interface AvailableAgentsPromptInput {
  readonly projectPath: string
  readonly agentDefinitionToggles?: Readonly<Record<string, boolean>>
  readonly sessionCapabilities?: readonly SessionCapability[]
  readonly modelMultiAgentEnabled?: boolean
  /** The Agent definition's tool allowlist; a Run whose allowlist leaves out hive lists nothing. */
  readonly toolAllowlist?: readonly string[]
  readonly mcpServerAllowlist?: readonly string[]
  /** Reads the catalog; replaced in tests. */
  readonly discover?: typeof discoverAgentDefinitions
}

async function loadAvailableAgents(input: AvailableAgentsPromptInput) {
  try {
    const { definitions } = await (input.discover ?? discoverAgentDefinitions)({
      projectPath: input.projectPath,
      enabledByName: input.agentDefinitionToggles ?? {},
      // Invalid definitions are dropped before the section's cut, so they never take a slot.
      limit: ALL_AGENT_DEFINITIONS,
    })
    return definitions
      .filter((definition) => definition.valid)
      .map(({ name, description }) => ({ name, description }))
  } catch (error) {
    // A broken catalog must not stop the Run; spawn with agent still reports the real error.
    logger.warn('Agent definitions could not be listed for the system prompt', {
      projectPath: input.projectPath,
      error: describeError(error),
    })
    return [] satisfies readonly AvailableAgent[]
  }
}

function allowsHive(input: AvailableAgentsPromptInput) {
  if (!input.toolAllowlist) return true
  return agentToolAllowlist({
    tools: input.toolAllowlist,
    ...(input.mcpServerAllowlist ? { mcpServers: input.mcpServerAllowlist } : {}),
  })(HIVE_TOOL_NAME)
}

/**
 * Writes `available_agents` into every turn's system prompt. The catalog is read once per Run, so
 * the section is byte-stable within a Run and across Runs while the definitions do not change;
 * it goes in a custom section after `cwd`, like the Session identity, so the prompt cache before
 * it stays shared by the project's Sessions.
 */
export function createAvailableAgentsPromptExtension(input: AvailableAgentsPromptInput) {
  const grant: SessionsToolActionGrant = {
    capabilities: input.sessionCapabilities,
    modelMultiAgentEnabled: input.modelMultiAgentEnabled ?? true,
  }
  const startsSessions = ['spawn', 'launch', 'create'].some((action) =>
    permitsSessionsToolAction(action, grant),
  )
  if (!startsSessions || !allowsHive(input)) return undefined
  return ((pi) => {
    let section: Promise<string | undefined> | undefined
    pi.on('before_agent_start', async (event) => {
      section ??= loadAvailableAgents(input).then((agents) =>
        availableAgentsPromptSection(agents, grant),
      )
      const content = await section
      if (content) event.systemPromptOptions.sections[AVAILABLE_AGENTS_PROMPT_SECTION] = content
      return undefined
    })
  }) satisfies SynchronousExtensionFactory | undefined
}
