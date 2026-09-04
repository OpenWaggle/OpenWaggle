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
      'Measured through the same bundled Pi SDK and provider path the app ships with (scripts/benchmark-first-turn-tokens.ts --live).',
      'The pi CLI at the same version, routed as a raw openai-completions endpoint, measures lower. The difference is Pi provider serialization, not extra context.',
    ],
  },
  pi: {
    name: 'Pi CLI',
    version: '0.84.4',
    routing: 'Raw openai-completions endpoint via proxy',
    notes: ["Pi's discipline is inherited by OpenWaggle: same runtime, same lean baseline."],
  },
  aider: {
    name: 'Aider',
    version: '0.86.2',
    routing: 'OpenAI-compatible endpoint via proxy',
    notes: [
      "Aider's famously compact prompt. In an empty project there is no repository map; on a real repo aider adds its map on top, within a documented token budget.",
    ],
  },
  dsh: {
    name: 'DeepSeek Harness',
    version: '0.1.2a3 (sdk-minimal profile)',
    routing: 'DeepSeek-compatible endpoint via proxy',
    notes: [
      "DeepSeek's first-party harness, run through its documented headless SDK profile: bash plus a file editor, built for benchmarking models in a minimal environment.",
      'The standard profile ships the full toolset and needs the Web UI; there is no headless path for it yet.',
    ],
  },
  reasonix: {
    name: 'DeepSeek Reasonix',
    version: '1.35.0',
    routing: 'Raw openai-completions endpoint via proxy',
    notes: [
      'Its CLI reports double because it re-sends the conversation to a completion validator; the wire shows one call. We report the wire.',
    ],
  },
  opencode: {
    name: 'opencode',
    version: '1.18.26',
    routing: 'Raw openai-completions endpoint via proxy',
    notes: [
      'Some configurations add a separate ~532-token session-title side call on a fresh conversation; it did not trigger in the pristine run.',
    ],
  },
  codex: {
    name: 'Codex CLI',
    version: '0.150.1',
    routing: 'Responses endpoint via proxy, model_reasoning_effort set',
    notes: [
      'OpenRouter rejects a bare reasoning.summary on its Responses endpoint; effort must be set explicitly.',
    ],
  },
  'claude-code': {
    name: 'Claude Code',
    version: '2.1.247',
    routing: 'Anthropic-compatible endpoint via proxy',
    notes: [
      "A run against the user's real home directory measured 22,260. Installed plugins alone added ~4,650 tokens, so the pristine-container number is the fair baseline.",
      'A native Bedrock run (claude-opus-5, eu-west-1) measured 16,911.',
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
  routing: 'OpenRouter, through a local logging proxy that records per-call prompt tokens',
  probePrompt: 'Reply with exactly OK and nothing else.',
  scriptPath: 'scripts/benchmark-first-turn-tokens.ts',
  environment:
    'Each agent ran in a pristine Docker container pinned to an exact version, with a fresh home directory, an empty project, and no AGENTS.md, skills, plugins, extensions, or MCP servers to discover. The harness ships in the repository.',
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
