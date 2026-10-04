/**
 * Usage statistics hooks inside the Pi adapter. Pi details are reduced here to published values:
 * provider and model only when they are Pi built-in catalog identifiers, built-in skill names,
 * feature flags and token counts. Everything else becomes `custom` or is not recorded.
 *
 * Catalog identifiers come from src/shared/usage-statistics/catalog.generated.ts, the same file
 * the statistics endpoint enforces, so the app and the endpoint cannot disagree on what is
 * `custom`. That file is generated from Pi's built-in catalog and the shared built-in skill list,
 * and `pnpm check:usage-statistics-catalog` fails while it is out of date.
 */
import path from 'node:path'
import { match } from '@diegogbrisa/ts-match'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import { DEFAULT_THINKING_LEVEL, THINKING_LEVELS, type ThinkingLevel } from '@shared/types/settings'
import {
  USAGE_STATISTICS_CATALOG_PROVIDER_MODELS,
  USAGE_STATISTICS_CATALOG_SKILLS,
} from '@shared/usage-statistics/catalog.generated'
import { USAGE_STATISTICS_CUSTOM_IDENTIFIER } from '@shared/usage-statistics/contract'
import { containsInlineVisualizationReference } from '@shared/utils/inline-visualization'
import { includes, isRecord } from '@shared/utils/validation'
import { getProjectPreferencesStrict } from '../../config/project-config'
import { isUsageStatisticsEnabled } from '../../usage-statistics/usage-statistics-enablement'
import { recordUsageStatistics } from '../../usage-statistics/usage-statistics-recorder'
import {
  addUsageStatisticsRunTokens,
  noteUsageStatisticsRunAccessMode,
  noteUsageStatisticsRunModel,
  noteUsageStatisticsRunProjectDefault,
  usageStatisticsRunNeedsProjectDefault,
} from '../../usage-statistics/usage-statistics-runs'
import { OPENWAGGLE_BUILT_IN_SKILLS_DIRECTORY } from './pi-built-in-skills'

const SKILL_FILE_NAME = 'SKILL.md'
/** `<root>/<skill name>/SKILL.md`, counted from the end of the path. */
const SKILL_DIRECTORY_SEGMENT = -2
const SKILLS_ROOT_SEGMENT = -3
const SKILL_COMMAND_PREFIX = '/skill:'
const BROWSER_PREVIEW_TOOL_PREFIX = 'preview_'
const READ_TOOL_NAME = 'read'

let catalog: ReadonlyMap<string, ReadonlySet<string>> | null = null
const catalogSkills: ReadonlySet<string> = new Set(USAGE_STATISTICS_CATALOG_SKILLS)

function catalogProviderModels() {
  catalog ??= new Map(
    Object.entries(USAGE_STATISTICS_CATALOG_PROVIDER_MODELS).map(([provider, models]) => [
      provider,
      new Set(models),
    ]),
  )
  return catalog
}

/** The provider and model as Pi built-in catalog identifiers, each one `custom` otherwise. */
export function piBuiltinCatalogIdentity(providerId: string, modelId: string) {
  const models = catalogProviderModels().get(providerId)
  if (!models) {
    return {
      provider: USAGE_STATISTICS_CUSTOM_IDENTIFIER,
      model: USAGE_STATISTICS_CUSTOM_IDENTIFIER,
    }
  }
  return {
    provider: providerId,
    model: models.has(modelId) ? modelId : USAGE_STATISTICS_CUSTOM_IDENTIFIER,
  }
}

function builtInSkillName(name: string) {
  return catalogSkills.has(name) ? name : USAGE_STATISTICS_CUSTOM_IDENTIFIER
}

/** The skill a `read` of `filePath` loads: a built-in name, `custom`, or nothing. */
export function piSkillReadIdentifier(filePath: string) {
  const normalized = filePath.replaceAll('\\', '/')
  if (path.posix.basename(normalized) !== SKILL_FILE_NAME) return undefined
  const segments = normalized.split('/')
  const skillName = segments.at(SKILL_DIRECTORY_SEGMENT)
  const root = segments.at(SKILLS_ROOT_SEGMENT)
  if (!skillName) return undefined
  return root === OPENWAGGLE_BUILT_IN_SKILLS_DIRECTORY
    ? builtInSkillName(skillName)
    : USAGE_STATISTICS_CUSTOM_IDENTIFIER
}

/** The skill a `/skill:name` prompt asks Pi to expand. */
export function piSkillCommandIdentifier(promptText: string) {
  if (!promptText.startsWith(SKILL_COMMAND_PREFIX)) return undefined
  const name = promptText.slice(SKILL_COMMAND_PREFIX.length).split(/\s/u, 1)[0] ?? ''
  return name ? builtInSkillName(name) : undefined
}

function toThinkingLevel(value: unknown): ThinkingLevel | undefined {
  return typeof value === 'string' && includes(THINKING_LEVELS, value) ? value : undefined
}

/** A Pi session is about to run `run.runId` with `model`. */
export function notePiRunForUsageStatistics(
  run: {
    readonly runId: string
    readonly payload: { readonly text: string }
    readonly session: { readonly executionThinkingLevel?: ThinkingLevel }
    readonly enabledOpenWaggleExtensionPackages?: readonly unknown[]
  },
  model: { readonly provider: string; readonly id: string },
  session: { readonly thinkingLevel: unknown },
): void {
  if (!isUsageStatisticsEnabled()) return
  noteUsageStatisticsRunModel(
    run.runId,
    piBuiltinCatalogIdentity(model.provider, model.id),
    toThinkingLevel(session.thinkingLevel) ??
      run.session.executionThinkingLevel ??
      DEFAULT_THINKING_LEVEL,
  )
  recordUsageStatistics({
    kind: 'extensions-enabled',
    count: run.enabledOpenWaggleExtensionPackages?.length ?? 0,
  })
  const skill = piSkillCommandIdentifier(run.payload.text)
  if (skill) recordUsageStatistics({ kind: 'skill', identifier: skill })
}

/**
 * A Pi run is starting. Its project default joins the Run's start mode unless the Run executor
 * already noted it from the project config it loads (every classic Run); an explicit Waggle,
 * which the executor never starts, reads it here, once. An unreadable project config counts as
 * Ask for Approval, as the authorization module treats it. Never rejects.
 */
export async function notePiRunProjectDefaultForUsageStatistics(
  runId: string,
  projectPath: string | null,
): Promise<void> {
  if (!usageStatisticsRunNeedsProjectDefault(runId)) return
  if (!projectPath) {
    noteUsageStatisticsRunProjectDefault(runId, null)
    return
  }
  const mode = await getProjectPreferencesStrict(projectPath).then(
    (preferences) => preferences?.authorizationMode ?? null,
    () => 'ask-for-approval' as const,
  )
  noteUsageStatisticsRunProjectDefault(runId, mode)
}

/**
 * The Run resolved its authorization mode for an approval, reading every level including the
 * project default. Wraps the resolver so the mode reported is the one the Run actually used.
 */
export function withUsageStatisticsAccessMode(
  runId: string,
  resolve: () => Promise<AgentAuthorizationMode>,
): () => Promise<AgentAuthorizationMode> {
  return async () => {
    const mode = await resolve()
    noteUsageStatisticsRunAccessMode(runId, mode)
    return mode
  }
}

/** Pi started a tool for the Run. */
export function observePiToolUseForUsageStatistics(toolName: string, args: unknown): void {
  if (!isUsageStatisticsEnabled()) return
  if (toolName.startsWith(BROWSER_PREVIEW_TOOL_PREFIX)) {
    recordUsageStatistics({ kind: 'feature', flag: 'browser_agent_driven' })
    return
  }
  if (toolName !== READ_TOOL_NAME || !isRecord(args) || typeof args.path !== 'string') return
  const skill = piSkillReadIdentifier(args.path)
  if (skill) recordUsageStatistics({ kind: 'skill', identifier: skill })
}

function assistantText(content: unknown) {
  if (!Array.isArray(content)) return ''
  return content
    .map((part: unknown) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .join('\n')
}

function usageNumber(usage: Readonly<Record<string, unknown>>, key: string) {
  const value = usage[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** One assistant response completed. Input counts every prompt token, cached or not. */
export function observePiAssistantMessageForUsageStatistics(
  runId: string,
  message: { readonly usage?: unknown; readonly content?: unknown },
): void {
  if (!isUsageStatisticsEnabled()) return
  if (isRecord(message.usage)) {
    const usage = message.usage
    addUsageStatisticsRunTokens(
      runId,
      usageNumber(usage, 'input') +
        usageNumber(usage, 'cacheRead') +
        usageNumber(usage, 'cacheWrite'),
      usageNumber(usage, 'output'),
    )
  }
  if (containsInlineVisualizationReference(assistantText(message.content))) {
    recordUsageStatistics({ kind: 'feature', flag: 'inline_visualization' })
  }
}

/** A compaction finished. Pi's portable mechanism is the published `fallback`. */
export function observePiCompactionForUsageStatistics(event: {
  readonly aborted: boolean
  readonly result?: { readonly details?: unknown } | undefined
}): void {
  if (event.aborted || !isUsageStatisticsEnabled()) return
  const details = event.result?.details
  if (!isRecord(details)) return
  const mechanism = match(details.mechanism)
    .with('native', () => 'native' as const)
    .with('portable', () => 'fallback' as const)
    .otherwise(() => undefined)
  if (mechanism) recordUsageStatistics({ kind: 'run-compacted', mechanism })
}
