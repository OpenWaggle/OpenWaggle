/**
 * Deterministic content for the generated large profile: Session titles and transcripts whose
 * size distribution resembles a heavy real profile (decision 8 of the v1 performance plan).
 */

const TOPICS = [
  'session host startup',
  'renderer bundle size',
  'MCP connection pool',
  'SQLite trigger cost',
  'streaming markdown',
  'compaction threshold',
  'worktree checkpoints',
  'provider catalog',
  'terminal reattach',
  'browser preview recording',
  'skills listing',
  'hive delegation review',
] as const

const CODE_LINE = 'export function measure(value: number): number { return value * 2 + 1 } // keep\n'
const PROSE_SENTENCE =
  'The measurement repeats under the same conditions, so the median is compared across builds. '
const MINUTE_MS = 60_000
const TITLE_PREFIX = 'Perf profile ·'
const PAD_WIDTH = 4
const PRNG_MULTIPLIER = 1_103_515_245
const PRNG_INCREMENT = 12_345
const PRNG_MODULUS = 2 ** 31
/** Users write shorter messages; assistants split theirs between prose and code. */
const SHORTER_SHARE = 2
const ROLE_ALTERNATION = 2

/** The text the sidebar shows once the generated Sessions are listed. */
export const GENERATED_SESSION_TITLE_PREFIX = TITLE_PREFIX

/** A small linear congruential generator: the same seed always yields the same profile. */
export function createRandom(seed: number) {
  let state = seed % PRNG_MODULUS
  return (exclusiveMaximum: number) => {
    state = (state * PRNG_MULTIPLIER + PRNG_INCREMENT) % PRNG_MODULUS
    return state % exclusiveMaximum
  }
}

export type Random = ReturnType<typeof createRandom>

export function sessionTitle(index: number) {
  const topic = TOPICS[index % TOPICS.length] ?? TOPICS[0]
  return `${TITLE_PREFIX} ${String(index).padStart(PAD_WIDTH, '0')} ${topic}`
}

function messageText(role: 'user' | 'assistant', index: number, approximateBytes: number) {
  const heading = `[turn ${String(index)}] `
  if (role === 'user') return `${heading}${PROSE_SENTENCE.repeat(Math.max(1, Math.round(approximateBytes / PROSE_SENTENCE.length)))}`
  const codeLines = Math.max(1, Math.round(approximateBytes / (SHORTER_SHARE * CODE_LINE.length)))
  const proseRepeats = Math.max(1, Math.round(approximateBytes / (SHORTER_SHARE * PROSE_SENTENCE.length)))
  return `${heading}${PROSE_SENTENCE.repeat(proseRepeats)}\n\n\`\`\`ts\n${CODE_LINE.repeat(codeLines)}\`\`\`\n`
}

/** One transcript: alternating user and assistant messages of roughly `averageBytes` each. */
export function transcript(input: {
  readonly sessionIndex: number
  readonly messageCount: number
  readonly averageBytes: number
  readonly endsAt: number
  readonly random: Random
}) {
  return Array.from({ length: input.messageCount }, (_, index) => {
    const role = index % ROLE_ALTERNATION === 0 ? 'user' : 'assistant'
    const bytes = role === 'user' ? input.averageBytes / SHORTER_SHARE : input.averageBytes + input.random(input.averageBytes)
    return {
      id: `perf-${String(input.sessionIndex)}-${String(index)}`,
      role,
      createdAt: input.endsAt - (input.messageCount - index) * MINUTE_MS,
      parts: [{ type: 'text', text: messageText(role, index, bytes) }],
    }
  })
}
