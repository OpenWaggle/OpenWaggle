import results from './benchmark-results.json'

export interface BenchmarkEntry {
  id: string
  name: string
  version: string
  /** Provider-reported prompt tokens of the agent's first model call. */
  turnOneTokens: number
  /** o200k tokens of the first request's system prompt and tool declarations. */
  prefixO200k: number
  toolCount: number
  highlight?: boolean
  routing: string
  notes: string[]
}

export interface BenchmarkRun {
  measuredAt: string
  model: string
  routing: string
  probePrompt: string
  scriptPath: string
  environment: string
  entry: BenchmarkEntry[]
}

interface EntryCopy {
  readonly name: string
  readonly version: string
  readonly routing: string
  readonly notes: readonly string[]
}

const ENTRY_COPY: Record<string, EntryCopy> = {
  openwaggle: {
    name: 'OpenWaggle',
    version: 'v1 performance build (packaged app)',
    routing: 'Packaged app on the host, OpenRouter provider via proxy',
    notes: [
      'The packaged app in hidden automation with its first-party extensions and default settings, not a bare SDK probe.',
      'Its two other model calls in the run, which generate and then refine the Session title, are not counted.',
    ],
  },
  pi: {
    name: 'Pi CLI',
    version: '1.4.0',
    routing: 'Raw openai-completions endpoint via proxy',
    notes: ['The Pi version OpenWaggle bundles. OpenWaggle adds its Hive, codemode and tool search on top.'],
  },
  opencode: {
    name: 'opencode',
    version: '1.19.4',
    routing: 'OpenAI-compatible provider via proxy',
    notes: ['The run made two model calls, the second a background title request; the chart counts the first.'],
  },
  codex: {
    name: 'Codex CLI',
    version: '0.164.0',
    routing: 'Responses endpoint via proxy, model_reasoning_effort set',
    notes: ['OpenRouter needs model_reasoning_effort set for the Responses endpoint.'],
  },
  'claude-code': {
    name: 'Claude Code',
    version: '2.1.311',
    routing: 'Anthropic-compatible endpoint via proxy',
    notes: [
      'Measured in a pristine container. Plugins and configuration on a developer machine can change input size.',
    ],
  },
}

/** The OpenWaggle build the run measured: its package version and source commit. */
export const openwaggleBuild: { readonly appVersion: string; readonly commit: string } = results.openwaggleBuild

const MEASURED_ENTRIES: BenchmarkEntry[] = results.entries.map((result) => {
  const copy = ENTRY_COPY[result.id]
  if (!copy) {
    throw new Error(`Unknown benchmark entry id: ${result.id}`)
  }
  return {
    id: result.id,
    name: copy.name,
    version: copy.version,
    turnOneTokens: result.turnOneTokens,
    prefixO200k: result.prefixO200k,
    toolCount: result.toolCount,
    ...(result.id === 'openwaggle' || result.id === 'pi' ? { highlight: true } : {}),
    routing: copy.routing,
    notes: [...copy.notes],
  }
})

export const benchmarkRun: BenchmarkRun = {
  measuredAt: results.measuredAt,
  model: results.model,
  routing: 'OpenRouter, every agent through the same local logging proxy',
  probePrompt: 'Reply with exactly OK and nothing else.',
  scriptPath: 'scripts/benchmark-docker/run.sh',
  environment:
    'Pi, opencode, Codex and Claude Code ran in pinned Docker containers with fresh homes and empty projects. OpenWaggle ran as the packaged app on the host with a throwaway profile and an empty project. All five went through the same proxy and model.',
  entry: MEASURED_ENTRIES,
}

const BAR_MIN_PERCENT = 6
const PERCENT_SCALE = 100

export const benchmarkMaxTokens = Math.max(
  ...benchmarkRun.entry.map((candidate) => candidate.turnOneTokens),
)

export function barWidthPercent(tokens: number) {
  const percent = (tokens / benchmarkMaxTokens) * PERCENT_SCALE
  return `${Math.max(BAR_MIN_PERCENT, percent).toFixed(1)}%`
}
