/**
 * DEPENDENCIES.md and the manifest pins it explains [DEP-03]. A pin that is not npm's `latest`
 * release, or that has a reason to stay where it is, has one row in the table there. This module
 * is pure: callers read the files, run git and ask the registry, so the CLI
 * (scripts/check-dependency-pins.ts) and the end-of-turn agent gate share the same rules.
 */

export const DEPENDENCIES_FILE = 'DEPENDENCIES.md'

const TABLE_HEADER = ['Package', 'Pin', 'Reason', 'Last known good'] as const
const TABLE_LINE = /^\|.*\|$/
const SEPARATOR_CELL = /^:?-{3,}:?$/
const UNESCAPED_PIPE = /(?<!\\)\|/
const CODE_SPAN = /^`([^`]+)`$/
const TRAILING_RULE = /^(?<text>.*) (?<rule>\[[A-Z]+-\d+\])$/
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
/** References resolve elsewhere: a catalog entry or a sibling workspace package. */
const REFERENCE_SPEC = /^(?:catalog|workspace):/
const PINNED_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const
const MANIFEST_LINE = 1

export interface DependencyRow {
  readonly package: string
  readonly pin: string
  readonly reason: string
  readonly lastKnownGood: string
  /** The 1-based line of the row in DEPENDENCIES.md. */
  readonly line: number
}

export interface ManifestPin {
  readonly package: string
  readonly spec: string
  /** The repository-relative manifest path, such as `packages/extension-sdk/package.json`. */
  readonly manifest: string
  /** `dependencies`, `devDependencies`, `optionalDependencies` or `catalog:<name>`. */
  readonly section: string
}

export type PinViolationKind =
  | 'missing-row'
  | 'stale-row'
  | 'unknown-row'
  | 'not-exact'
  | 'latest-unknown'

export interface PinViolation {
  readonly package: string
  /** The manifest the finding is about, or DEPENDENCIES.md for a row finding. */
  readonly manifest: string
  /** The DEPENDENCIES.md row line for a row finding, otherwise 1. */
  readonly line: number
  /** One line that ends with the rule ID, such as `[DEP-03]`. */
  readonly message: string
  readonly kind: PinViolationKind
}

export type TableFindingKind = 'no-table' | 'bad-row' | 'duplicate-row'

export interface TableFinding {
  readonly line: number
  readonly kind: TableFindingKind
  /** One line that ends with `[DEP-03]`. */
  readonly message: string
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function code(text: string) {
  return `\`${text}\``
}

/**
 * `file:line:1 kind [RULE] message`, the line format of the repository checks. The rule ID moves
 * from the end of the message to the front.
 */
export function formatPinFinding(finding: {
  readonly file: string
  readonly line: number
  readonly kind: string
  readonly message: string
}) {
  const groups = TRAILING_RULE.exec(finding.message)?.groups
  const text = groups?.text ?? finding.message
  const rule = groups?.rule ?? '[DEP-03]'
  return `${finding.file}:${finding.line}:1 ${finding.kind} ${rule} ${text}`
}

function tableCells(line: string) {
  const trimmed = line.trim()
  if (!TABLE_LINE.test(trimmed)) return undefined
  return trimmed
    .slice(1, -1)
    .split(UNESCAPED_PIPE)
    .map((cell) => cell.trim())
}

function isHeader(cells: readonly string[] | undefined) {
  return (
    cells !== undefined &&
    cells.length === TABLE_HEADER.length &&
    TABLE_HEADER.every((name, index) => cells[index] === name)
  )
}

function unquote(cell: string) {
  return CODE_SPAN.exec(cell)?.[1] ?? cell
}

function parseRow(cells: readonly string[], line: number): DependencyRow | TableFinding {
  const [name = '', pin = '', reason = '', lastKnownGood = ''] = cells.map(unquote)
  if (cells.length !== TABLE_HEADER.length || !name || !pin || !reason || !lastKnownGood) {
    return {
      line,
      kind: 'bad-row',
      message: `a row needs four non-empty cells: Package, Pin, Reason, Last known good [DEP-03]`,
    }
  }
  return { package: name, pin, reason, lastKnownGood, line }
}

/** Every row of the `| Package | Pin | Reason | Last known good |` table, and what is wrong. */
export function parseDependencyTable(markdown: string) {
  const lines = markdown.split('\n')
  const rows: DependencyRow[] = []
  const findings: TableFinding[] = []
  const headerIndex = lines.findIndex((line) => isHeader(tableCells(line)))
  if (headerIndex < 0) {
    findings.push({
      line: 1,
      kind: 'no-table',
      message: `no "| ${TABLE_HEADER.join(' | ')} |" table [DEP-03]`,
    })
    return { rows, findings }
  }
  const separatorIndex = headerIndex + 1
  const separator = tableCells(lines[separatorIndex] ?? '')
  if (!separator?.every((cell) => SEPARATOR_CELL.test(cell))) {
    findings.push({
      line: separatorIndex + 1,
      kind: 'bad-row',
      message: 'the table header needs a separator row [DEP-03]',
    })
  }
  const seen = new Map<string, number>()
  for (let index = separatorIndex + 1; index < lines.length; index += 1) {
    const cells = tableCells(lines[index] ?? '')
    if (!cells) break
    const row = parseRow(cells, index + 1)
    if (!('package' in row)) {
      findings.push(row)
      continue
    }
    const key = `${row.package}@${row.pin}`
    const first = seen.get(key)
    if (first === undefined) {
      seen.set(key, row.line)
      rows.push(row)
      continue
    }
    findings.push({
      line: row.line,
      kind: 'duplicate-row',
      message: `${code(row.package)} ${code(row.pin)} already has a row on line ${first} [DEP-03]`,
    })
  }
  return { rows, findings }
}

/** The rows of DEPENDENCIES.md; each problem is a printable `DEPENDENCIES.md:<line>:1` line. */
export function parseDependencyRows(markdown: string): {
  rows: readonly DependencyRow[]
  problems: readonly string[]
} {
  const { rows, findings } = parseDependencyTable(markdown)
  return {
    rows,
    problems: findings.map((finding) => formatPinFinding({ file: DEPENDENCIES_FILE, ...finding })),
  }
}

function sectionPins(manifest: string, section: string, value: unknown) {
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([name, spec]): ManifestPin[] =>
    typeof spec === 'string' ? [{ package: name, spec, manifest, section }] : [],
  )
}

/**
 * The dependency, devDependency and optionalDependency specs of one manifest, plus the catalog
 * entries under `workspaces` (section `catalog:<name>`, `catalog:default` for `workspaces.catalog`).
 * Peer dependencies state what a published package accepts, so they are not pins.
 */
export function manifestPins(manifestPath: string, manifestText: string): readonly ManifestPin[] {
  const manifest: unknown = JSON.parse(manifestText)
  if (!isRecord(manifest)) return []
  const pins = PINNED_SECTIONS.flatMap((section) =>
    sectionPins(manifestPath, section, manifest[section]),
  )
  const { workspaces } = manifest
  if (!isRecord(workspaces)) return pins
  pins.push(...sectionPins(manifestPath, 'catalog:default', workspaces.catalog))
  if (isRecord(workspaces.catalogs)) {
    for (const [name, catalog] of Object.entries(workspaces.catalogs)) {
      pins.push(...sectionPins(manifestPath, `catalog:${name}`, catalog))
    }
  }
  return pins
}

function pinKey(pin: ManifestPin) {
  return `${pin.manifest}\u0000${pin.section}\u0000${pin.package}`
}

/** Pins added or given a new spec in `after`; `workspace:` and `catalog:` references are skipped. */
export function changedPins(
  before: readonly ManifestPin[],
  after: readonly ManifestPin[],
): readonly ManifestPin[] {
  const previous = new Map(before.map((pin) => [pinKey(pin), pin.spec]))
  return after.filter(
    (pin) => !REFERENCE_SPEC.test(pin.spec) && previous.get(pinKey(pin)) !== pin.spec,
  )
}

function rowViolations(rows: readonly DependencyRow[], all: readonly ManifestPin[]) {
  const specs = new Map<string, Set<string>>()
  for (const pin of all) {
    if (REFERENCE_SPEC.test(pin.spec)) continue
    specs.set(pin.package, (specs.get(pin.package) ?? new Set()).add(pin.spec))
  }
  return rows.flatMap((row): PinViolation[] => {
    const pinned = specs.get(row.package)
    const base = { package: row.package, manifest: DEPENDENCIES_FILE, line: row.line }
    if (!pinned) {
      return [
        {
          ...base,
          kind: 'unknown-row',
          message: `no manifest pins ${code(row.package)}; remove its row [DEP-03]`,
        },
      ]
    }
    if (pinned.has(row.pin)) return []
    const current = [...pinned].map(code).join(', ')
    return [
      {
        ...base,
        kind: 'stale-row',
        message: `the row pins ${code(row.package)} ${code(row.pin)} but the manifests pin ${current}; update or remove the row [DEP-03]`,
      },
    ]
  })
}

async function changedPinViolation(
  pin: ManifestPin,
  rows: readonly DependencyRow[],
  latest: (name: string) => Promise<string | undefined>,
): Promise<PinViolation | undefined> {
  const base = { package: pin.package, manifest: pin.manifest, line: MANIFEST_LINE }
  const where = `${code(pin.package)} ${code(pin.spec)} in ${pin.section}`
  if (!EXACT_VERSION.test(pin.spec)) {
    return {
      ...base,
      kind: 'not-exact',
      message: `${where} is a range; pin an exact version (docs/dependency-updates.md) [DEP-01]`,
    }
  }
  if (rows.some((row) => row.package === pin.package && row.pin === pin.spec)) return undefined
  const newest = await latest(pin.package)
  if (newest === pin.spec) return undefined
  if (newest === undefined) {
    return {
      ...base,
      kind: 'latest-unknown',
      message: `${where} has no ${DEPENDENCIES_FILE} row and the registry's latest version could not be read; add a row or rerun online [DEP-03]`,
    }
  }
  return {
    ...base,
    kind: 'missing-row',
    message: `${where} is not the latest release (${code(newest)}); add a ${DEPENDENCIES_FILE} row with Pin ${code(pin.spec)} [DEP-03]`,
  }
}

/**
 * What breaks DEP-03 (and DEP-01 for a changed range): changed pins behind `latest` without a row,
 * rows whose Pin no manifest uses any more, and rows for packages no manifest pins. `latest` is
 * asked only about changed exact pins without a row, so row findings need no network.
 */
export async function pinViolations(input: {
  readonly changed: readonly ManifestPin[]
  readonly all: readonly ManifestPin[]
  readonly rows: readonly DependencyRow[]
  readonly latest: (name: string) => Promise<string | undefined>
}): Promise<readonly PinViolation[]> {
  const changed = await Promise.all(
    input.changed
      .filter((pin) => !REFERENCE_SPEC.test(pin.spec))
      .map((pin) => changedPinViolation(pin, input.rows, input.latest)),
  )
  return [
    ...rowViolations(input.rows, input.all),
    ...changed.filter((violation) => violation !== undefined),
  ]
}
