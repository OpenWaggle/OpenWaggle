/**
 * Coverage uniqueness (.agents/standards.md, Testing): the statements and branch arms each test
 * file covers, folded into an index that tells, for every unit, whether no file, one file (which) or several cover it.
 *
 * A unit is `src/file.ts:line:column` for a statement and `src/file.ts:line:column#arm` for a
 * branch arm, in source coordinates, from a v8 `coverage-final.json` (Istanbul shape).
 */

/** Two coverers are enough: a unit is either unique to one file or shared. */
const MAX_COVERERS = 2
export const COVERAGE_INDEX_VERSION = 1

export interface CoverageIndex {
  readonly version: typeof COVERAGE_INDEX_VERSION
  readonly commit: string
  readonly generatedAt: string
  /** The test files measured, by position; `units` refers to them by index. */
  readonly files: readonly string[]
  /** Test files whose run failed: their units are missing, so treat the index as partial. */
  readonly failed: readonly string[]
  /** Unit to the first one or two files (by position in `files`) that cover it. */
  readonly units: Readonly<Record<string, readonly number[]>>
  readonly durationMs: number
}

/** Source files whose coverage counts: product and tooling code, not tests or test support. */
const SOURCE = /^(?:src|scripts|functions|website\/src|e2e\/support|packages\/[^/]+\/src)\//u
const TEST_CODE = /\.test\.tsx?$|__tests__|test-support|test-utils/u

interface Location {
  readonly line: number
  readonly column: number
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? { ...value } : {}
}

function location(value: unknown): Location | undefined {
  const start = record(record(value).start)
  const line = start.line
  const column = start.column
  return typeof line === 'number' && typeof column === 'number' ? { line, column } : undefined
}

/** The units one file's `coverage-final.json` reached, with paths relative to `root`. */
export function coveredUnits(coverage: unknown, root: string): string[] {
  const units: string[] = []
  const prefix = root.endsWith('/') ? root : `${root}/`
  for (const [absolute, raw] of Object.entries(record(coverage))) {
    const file = absolute.startsWith(prefix) ? absolute.slice(prefix.length) : absolute
    if (!SOURCE.test(file) || TEST_CODE.test(file)) continue
    const entry = record(raw)
    const statementMap = record(entry.statementMap)
    for (const [id, hits] of Object.entries(record(entry.s))) {
      const start = location(statementMap[id])
      if (typeof hits === 'number' && hits > 0 && start) {
        units.push(`${file}:${start.line}:${start.column}`)
      }
    }
    const branchMap = record(entry.branchMap)
    for (const [id, arms] of Object.entries(record(entry.b))) {
      const start = location(record(branchMap[id]).loc)
      if (!Array.isArray(arms) || !start) continue
      arms.forEach((hits: unknown, arm) => {
        if (typeof hits === 'number' && hits > 0) {
          units.push(`${file}:${start.line}:${start.column}#${arm}`)
        }
      })
    }
  }
  return units
}

/** Folds measured files into an index; a file measured twice keeps its last units. */
export class CoverageIndexBuilder {
  private readonly files: string[] = []
  private readonly positions = new Map<string, number>()
  private readonly failed = new Set<string>()
  private readonly units = new Map<string, number[]>()

  add(file: string, units: readonly string[] | undefined) {
    if (units === undefined) {
      this.failed.add(file)
      return
    }
    const position = this.position(file)
    for (const unit of units) this.cover(unit, position)
  }

  /** Adds every file and unit of another index (a shard of the same commit). */
  merge(index: CoverageIndex) {
    for (const file of index.failed) this.failed.add(file)
    const positions = index.files.map((file) => this.position(file))
    for (const [unit, coverers] of Object.entries(index.units)) {
      for (const position of coverers) {
        const mapped = positions[position]
        if (mapped !== undefined) this.cover(unit, mapped)
      }
    }
  }

  build(commit: string, durationMs: number): CoverageIndex {
    return {
      version: COVERAGE_INDEX_VERSION,
      commit,
      generatedAt: new Date().toISOString(),
      files: [...this.files],
      failed: [...this.failed].toSorted(),
      units: Object.fromEntries(this.units),
      durationMs,
    }
  }

  private cover(unit: string, position: number) {
    const coverers = this.units.get(unit)
    if (coverers === undefined) {
      this.units.set(unit, [position])
      return
    }
    if (coverers.length < MAX_COVERERS && !coverers.includes(position)) coverers.push(position)
  }

  private position(file: string) {
    const known = this.positions.get(file)
    if (known !== undefined) return known
    this.files.push(file)
    this.positions.set(file, this.files.length - 1)
    return this.files.length - 1
  }
}

/** The units `file` covers that the index has no other test file covering. */
export function uniqueUnits(index: CoverageIndex, file: string, units: readonly string[]) {
  const self = index.files.indexOf(file)
  return [...new Set(units)].filter((unit) => {
    const coverers = index.units[unit] ?? []
    return coverers.every((position) => position === self)
  })
}

export function isCoverageIndex(value: unknown): value is CoverageIndex {
  const entry = record(value)
  return (
    entry.version === COVERAGE_INDEX_VERSION &&
    Array.isArray(entry.files) &&
    Array.isArray(entry.failed) &&
    typeof entry.units === 'object' &&
    entry.units !== null
  )
}
