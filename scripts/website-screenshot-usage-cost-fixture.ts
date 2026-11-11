import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { electrobunAppHome } from './support/electrobun-app-launch'
import {
  type FixtureSession,
  type Rates,
  USAGE_COST_SESSIONS,
} from './website-screenshot-usage-cost-sessions'

/**
 * Made-up Pi session files for the Usage & Cost page, written into the scratch Pi agent
 * directory's `sessions/` the way Pi writes them (`pi-usage-cost-parse.ts` reads them back): a
 * header, model changes, prompts, assistant messages with usage, and a compaction. Most records
 * carry the cost Pi recorded; the `pi` CLI sessions' records carry none, which the app prices
 * from Pi's built-in catalog (`builtinModels()`), so the chart shows estimated bars. OpenWaggle
 * sessions carry an `openwaggle-` custom entry, which is how the page tells them from other Pi
 * clients.
 *
 * The working directories are invented paths outside `/tmp` (the scanner groups every session
 * under `/tmp`, where the scratch profile lives, as "Temporary directory"); their last segments
 * are the two fixture projects.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const MILLION = 1_000_000
/** The page's default window is 30 days; the sessions fill the last 28 of them. */
const SPREAD_DAYS = 28
const SEED = 0x5eed
const PROJECT_ROOT = '/Users/sam/code'
const PI_SESSION_VERSION = 3
/** Each turn takes two minutes: the prompt or tool results, then the reply. */
const MINUTES_PER_TURN = 2
/** Sessions start at 09:00 local time, then 70 minutes later for each of the next six. */
const DAY_START_HOUR = 9
const START_STEP_MINUTES = 70
const START_SLOTS = 7
/** Today's session starts at least this long before the capture. */
const LATEST_START_MINUTES = 60
const COMPACTION_TOKENS_BEFORE = 180_000
/** The ranges each turn's tokens are drawn from. */
const TURN_TOKENS = {
  input: [1_500, 14_000],
  output: [600, 4_800],
  cacheRead: [18_000, 120_000],
  cacheWrite: [2_000, 16_000],
} as const
const COMPACTION_TOKENS = { input: [40_000, 90_000], output: [1_200, 2_400] } as const
/** A linear congruential generator's constants (glibc's). */
const LCG = { multiplier: 1_103_515_245, increment: 12_345, modulus: 2 ** 31 } as const

/** A small deterministic generator, so every run writes the same tokens. */
function generator(seed: number) {
  let state = seed
  return ([min, max]: readonly [number, number]) => {
    state = (state * LCG.multiplier + LCG.increment) % LCG.modulus
    return Math.round(min + (state / LCG.modulus) * (max - min))
  }
}

function costOf(rates: Rates, tokens: Rates) {
  const parts = {
    input: (tokens.input * rates.input) / MILLION,
    output: (tokens.output * rates.output) / MILLION,
    cacheRead: (tokens.cacheRead * rates.cacheRead) / MILLION,
    cacheWrite: (tokens.cacheWrite * rates.cacheWrite) / MILLION,
  }
  return { ...parts, total: parts.input + parts.output + parts.cacheRead + parts.cacheWrite }
}

/** Pi's per-folder session directory name for a working directory. */
export function piSessionDirectoryName(cwd: string) {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
}

function sessionLines(
  session: FixtureSession,
  startedAt: number,
  next: ReturnType<typeof generator>,
) {
  const cwd = path.join(PROJECT_ROOT, session.project)
  const id = crypto.randomUUID()
  const at = (offsetMinutes: number) =>
    new Date(startedAt + offsetMinutes * MINUTE_MS).toISOString()
  const { provider, modelId } = session.model
  const lines: unknown[] = [
    { type: 'session', version: PI_SESSION_VERSION, id, timestamp: at(0), cwd },
    { type: 'model_change', id: `${id}-m`, parentId: null, timestamp: at(0), provider, modelId },
  ]
  if (session.origin === 'openwaggle') {
    lines.push({
      type: 'custom',
      customType: 'openwaggle-run-boundary',
      data: { version: 1, runId: `${id}-run` },
      id: `${id}-c`,
      parentId: null,
      timestamp: at(0),
    })
  }
  lines.push({
    type: 'message',
    id: `${id}-u`,
    parentId: null,
    timestamp: at(0),
    message: {
      role: 'user',
      content: [{ type: 'text', text: session.prompt }],
      timestamp: startedAt,
    },
  })
  for (let turn = 0; turn < session.turns; turn += 1) {
    const tokens = {
      input: next(TURN_TOKENS.input),
      output: next(TURN_TOKENS.output),
      cacheRead: turn === 0 ? 0 : next(TURN_TOKENS.cacheRead),
      cacheWrite: session.model.provider === 'anthropic' ? next(TURN_TOKENS.cacheWrite) : 0,
    }
    const usage = {
      ...tokens,
      totalTokens: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite,
      // The `pi` CLI sessions here were written without a cost.
      ...(session.origin === 'pi-cli' ? {} : { cost: costOf(session.model.rates, tokens) }),
    }
    const replyMinute = turn * MINUTES_PER_TURN + 1
    lines.push({
      type: 'message',
      id: `${id}-a${String(turn)}`,
      parentId: null,
      timestamp: at(replyMinute),
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Done.' }],
        provider,
        model: modelId,
        usage,
        stopReason: 'stop',
        timestamp: startedAt + replyMinute * MINUTE_MS,
      },
    })
  }
  if (session.compacted) {
    const tokens = {
      input: next(COMPACTION_TOKENS.input),
      output: next(COMPACTION_TOKENS.output),
      cacheRead: 0,
      cacheWrite: 0,
    }
    lines.push({
      type: 'compaction',
      id: `${id}-k`,
      parentId: null,
      timestamp: at(session.turns * MINUTES_PER_TURN + 1),
      summary: 'Summary of the earlier turns.',
      firstKeptEntryId: `${id}-a0`,
      tokensBefore: COMPACTION_TOKENS_BEFORE,
      usage: {
        ...tokens,
        totalTokens: tokens.input + tokens.output,
        cost: costOf(session.model.rates, tokens),
      },
    })
  }
  return { cwd, id, lines }
}

/**
 * Writes the sessions under `<scratch HOME>/.pi/agent/sessions/`, timed relative to `now` so the
 * daily chart fills the default 30-day window on any capture date.
 */
export async function writeUsageCostSessions(input: {
  readonly userDataDir: string
  readonly homeDir: string
  readonly now: Date
}) {
  const { piAgentDir } = electrobunAppHome(input)
  const sessionsRoot = path.join(piAgentDir, 'sessions')
  const next = generator(SEED)
  const today = new Date(input.now)
  today.setHours(DAY_START_HOUR, 0, 0, 0)
  for (const [index, session] of USAGE_COST_SESSIONS.entries()) {
    if (session.daysAgo > SPREAD_DAYS) {
      throw new Error('A usage fixture session is outside the window.')
    }
    // Spread across the working day; today's session starts no later than an hour ago.
    const offset = (index % START_SLOTS) * START_STEP_MINUTES * MINUTE_MS
    const startedAt = Math.min(
      today.getTime() - session.daysAgo * DAY_MS + offset,
      input.now.getTime() - LATEST_START_MINUTES * MINUTE_MS,
    )
    const { cwd, id, lines } = sessionLines(session, startedAt, next)
    const directory = path.join(sessionsRoot, piSessionDirectoryName(cwd))
    await fs.mkdir(directory, { recursive: true })
    const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-')
    await fs.writeFile(
      path.join(directory, `${stamp}_${id}.jsonl`),
      `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
    )
  }
}
