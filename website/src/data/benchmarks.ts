import results from './benchmark-results.json'

export interface BenchmarkEntry {
  id: string
  name: string
  version: string
  turnOneTokens: number
  perTurnDelta?: number
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
    version: '',
    routing: 'Bundled Pi SDK, native OpenRouter provider, fresh agent dir',
    notes: [
      'Historical bundled-SDK probe using scripts/benchmark-first-turn-tokens.ts --live, not a fully configured GUI session.',
      'Measured separately from the container rows. The archived container logs do not include its raw run output.',
    ],
  },
  pi: {
    name: 'Pi CLI',
    version: '0.84.4',
    routing: 'Raw openai-completions endpoint via proxy',
    notes: ['Historical Pi 0.84.4 CLI result. Its provider route differs from the OpenWaggle SDK probe.'],
  },
  aider: {
    name: 'Aider',
    version: '0.86.2',
    routing: 'OpenAI-compatible endpoint via proxy',
    notes: [
      'Measured in an empty project. Repository context can increase input size in a real project.',
    ],
  },
  dsh: {
    name: 'DeepSeek Harness',
    version: '0.1.2a3 (sdk-minimal profile)',
    routing: 'DeepSeek-compatible endpoint via proxy',
    notes: [
      'Measured using the headless sdk-minimal profile, not the full interactive toolset.',
    ],
  },
  reasonix: {
    name: 'DeepSeek Reasonix',
    version: '1.35.0',
    routing: 'Raw openai-completions endpoint via proxy',
    notes: [
      'The CLI reported 10,558 input tokens; the archive records one model call with 5,279. The chart uses API usage, without attributing the discrepancy to an unverified cause.',
    ],
  },
  opencode: {
    name: 'opencode',
    version: '1.18.26',
    routing: 'Raw openai-completions endpoint via proxy',
    notes: [
      'The archived run contains one model call. Other configurations can add calls or context.',
    ],
  },
  codex: {
    name: 'Codex CLI',
    version: '0.150.1',
    routing: 'Responses endpoint via proxy, model_reasoning_effort set',
    notes: [
      'The measured container configuration explicitly set model_reasoning_effort.',
    ],
  },
  'claude-code': {
    name: 'Claude Code',
    version: '2.1.247',
    routing: 'Anthropic-compatible endpoint via proxy',
    notes: [
      'Measured in a pristine container. Plugins and configuration on a developer machine can change input size.',
    ],
  },
}

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
    ...(result.perTurnDelta !== undefined ? { perTurnDelta: result.perTurnDelta } : {}),
    ...(result.id === 'openwaggle' || result.id === 'pi' ? { highlight: true } : {}),
    routing: copy.routing,
    notes: [...copy.notes],
  }
})

export const benchmarkRun: BenchmarkRun = {
  measuredAt: results.measuredAt,
  model: results.model,
  routing: 'OpenRouter: seven container rows through a logging proxy; OpenWaggle measured separately through the bundled Pi SDK provider',
  probePrompt: 'Reply with exactly OK and nothing else.',
  scriptPath: 'scripts/benchmark-first-turn-tokens.ts',
  environment:
    'The seven non-OpenWaggle rows used pinned Docker containers with fresh homes and empty projects. The OpenWaggle row used a separate SDK probe with temporary project and agent directories. These are historical first-call measurements, not current-release task costs.',
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
