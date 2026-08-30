import { SessionFlatVectorIndex } from '../src/main/adapters/session-flat-vector-index'

const DIMENSIONS = 384
const RESULT_LIMIT = 1_000
const RUNS_PER_SIZE = 7
const WARMUP_RUNS = 2
const JSON_INDENT_SPACES = 2
const CORPUS_SIZES = [1_000, 10_000, 50_000, 100_000] as const
const LCG_MULTIPLIER = 1_664_525
const LCG_INCREMENT = 1_013_904_223
const UINT32_MAXIMUM = 0xffff_ffff
const CENTER_OFFSET = 0.5
const SESSION_ID_WIDTH = 6
const P50 = 0.5
const P95 = 0.95
const BYTES_PER_MEBIBYTE = 1_048_576
const MAXIMUM_P95_MS = 250

function makeVector(seed: number) {
  const vector = new Float32Array(DIMENSIONS)
  let state = seed + 1
  let squaredMagnitude = 0
  for (let index = 0; index < vector.length; index += 1) {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0
    const value = state / UINT32_MAXIMUM - CENTER_OFFSET
    vector[index] = value
    squaredMagnitude += value * value
  }
  const magnitude = Math.sqrt(squaredMagnitude)
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = (vector[index] ?? 0) / magnitude
  }
  return vector
}

function percentile(sorted: readonly number[], fraction: number) {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  return sorted[index] ?? 0
}

function benchmarkSize(size: number) {
  const index = new SessionFlatVectorIndex()
  const startedAt = performance.now()
  index.replace(
    Array.from({ length: size }, (_, itemIndex) => ({
      sessionId: `session-${String(itemIndex).padStart(SESSION_ID_WIDTH, '0')}`,
      vector: makeVector(itemIndex),
    })),
  )
  const loadMs = performance.now() - startedAt
  const query = makeVector(size + 1)
  const timings: number[] = []
  for (let run = 0; run < WARMUP_RUNS + RUNS_PER_SIZE; run += 1) {
    const searchStartedAt = performance.now()
    const matches = index.search(query, RESULT_LIMIT)
    const elapsed = performance.now() - searchStartedAt
    if (matches.length !== Math.min(size, RESULT_LIMIT)) {
      throw new Error(`Vector benchmark returned ${String(matches.length)} matches for ${size}.`)
    }
    if (run >= WARMUP_RUNS) timings.push(elapsed)
  }
  const sorted = timings.toSorted((left, right) => left - right)
  return {
    size,
    dimensions: DIMENSIONS,
    resultLimit: RESULT_LIMIT,
    loadMs,
    searchP50Ms: percentile(sorted, P50),
    searchP95Ms: percentile(sorted, P95),
    residentMemoryMb: process.memoryUsage().rss / BYTES_PER_MEBIBYTE,
    passed: percentile(sorted, P95) < MAXIMUM_P95_MS,
  }
}

const results = CORPUS_SIZES.map(benchmarkSize)
process.stdout.write(`${JSON.stringify(results, null, JSON_INDENT_SPACES)}\n`)
if (results.some((result) => !result.passed)) process.exitCode = 1
