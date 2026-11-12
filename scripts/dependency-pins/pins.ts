import { safeDecodeUnknown, Schema } from '@shared/schema'
import { lenientOptional, lenientRecord, lenientStringRecordSchema } from '@shared/schemas/lenient'
/**
 * DEPENDENCIES.md and the manifest pins it explains. A pin that is not npm's `latest` release, or
 * that something holds where it is, has one line there:
 *
 *   - `name@version`. Held: why it stays. Unblocked by: what lets it move.
 *
 * This module is pure: the CLI (scripts/check-dependency-pins.ts) reads the files, runs git and
 * asks the registry.
 */

export const DEPENDENCIES_FILE = 'DEPENDENCIES.md'

/** A list item that starts with a code span: a pin line, well formed or not. */
const PIN_ITEM = '- `'
const PIN_LINE = /^- `(?<spec>[^`]+)`\. Held: (?<held>.+?)\. Unblocked by: (?<unblockedBy>.+?)\.?$/u
const LINE_FORMAT = '- `name@version`. Held: <why>. Unblocked by: <what>.'
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
/** References resolve elsewhere: a catalog entry or a sibling workspace package. */
const REFERENCE_SPEC = /^(?:catalog|workspace):/
const PINNED_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const
const MANIFEST_LINE = 1

export interface DependencyLine {
  readonly package: string
  readonly pin: string
  readonly held: string
  readonly unblockedBy: string
  /** The 1-based line in DEPENDENCIES.md. */
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
  | 'missing-line'
  | 'stale-line'
  | 'unknown-line'
  | 'not-exact'
  | 'latest-unknown'

export interface PinViolation {
  readonly package: string
  /** The manifest the finding is about, or DEPENDENCIES.md for a line finding. */
  readonly manifest: string
  /** The DEPENDENCIES.md line for a line finding, otherwise 1. */
  readonly line: number
  readonly message: string
  readonly kind: PinViolationKind
}

export type LineFindingKind = 'bad-line' | 'duplicate-line'

export interface LineFinding {
  readonly line: number
  readonly kind: LineFindingKind
  readonly message: string
}

function code(text: string) {
  return `\`${text}\``
}

/** `file:line:1 kind message`, the line format of the repository checks. */
export function formatPinFinding(finding: {
  readonly file: string
  readonly line: number
  readonly kind: string
  readonly message: string
}) {
  return `${finding.file}:${finding.line}:1 ${finding.kind} ${finding.message}`
}

/** `name@version` split at the last `@` that is not the scope's. */
function splitSpec(spec: string) {
  const at = spec.lastIndexOf('@')
  if (at <= 0) return undefined
  const name = spec.slice(0, at)
  const pin = spec.slice(at + 1)
  return name && pin ? { name, pin } : undefined
}

function parseLine(text: string, line: number): DependencyLine | LineFinding {
  const groups = PIN_LINE.exec(text)?.groups
  const spec = splitSpec(groups?.spec ?? '')
  const held = groups?.held?.trim() ?? ''
  const unblockedBy = groups?.unblockedBy?.trim() ?? ''
  if (spec === undefined || !held || !unblockedBy) {
    return { line, kind: 'bad-line', message: `a pin line reads ${code(LINE_FORMAT)}` }
  }
  return { package: spec.name, pin: spec.pin, held, unblockedBy, line }
}

/** Every pin line of DEPENDENCIES.md, and what is wrong with them. */
export function parseDependencyLines(markdown: string) {
  const lines: DependencyLine[] = []
  const findings: LineFinding[] = []
  const seen = new Map<string, number>()
  for (const [index, text] of markdown.split('\n').entries()) {
    if (!text.startsWith(PIN_ITEM)) continue
    const parsed = parseLine(text.trimEnd(), index + 1)
    if (!('package' in parsed)) {
      findings.push(parsed)
      continue
    }
    const key = `${parsed.package}@${parsed.pin}`
    const first = seen.get(key)
    if (first === undefined) {
      seen.set(key, parsed.line)
      lines.push(parsed)
      continue
    }
    findings.push({
      line: parsed.line,
      kind: 'duplicate-line',
      message: `${code(key)} already has a line on line ${first}`,
    })
  }
  return { lines, findings }
}

/** The pinned sections of a package manifest; a malformed section or spec pins nothing. */
const pinnedManifestSchema = Schema.Struct({
  dependencies: lenientOptional(lenientStringRecordSchema),
  devDependencies: lenientOptional(lenientStringRecordSchema),
  optionalDependencies: lenientOptional(lenientStringRecordSchema),
  workspaces: lenientOptional(
    Schema.Struct({
      catalog: lenientOptional(lenientStringRecordSchema),
      catalogs: lenientOptional(lenientRecord(lenientStringRecordSchema)),
    }),
  ),
})

function sectionPins(
  manifest: string,
  section: string,
  specs: Readonly<Record<string, string>> | undefined,
) {
  return Object.entries(specs ?? {}).map(([name, spec]): ManifestPin => ({
    package: name,
    spec,
    manifest,
    section,
  }))
}

/**
 * The dependency, devDependency and optionalDependency specs of one manifest, plus the catalog
 * entries under `workspaces` (section `catalog:<name>`, `catalog:default` for `workspaces.catalog`).
 * Peer dependencies state what a published package accepts, so they are not pins.
 */
export function manifestPins(manifestPath: string, manifestText: string): readonly ManifestPin[] {
  const decoded = safeDecodeUnknown(pinnedManifestSchema, JSON.parse(manifestText))
  if (!decoded.success) return []
  const manifest = decoded.data
  const pins = PINNED_SECTIONS.flatMap((section) =>
    sectionPins(manifestPath, section, manifest[section]),
  )
  const { workspaces } = manifest
  if (workspaces === undefined) return pins
  pins.push(...sectionPins(manifestPath, 'catalog:default', workspaces.catalog))
  for (const [name, catalog] of Object.entries(workspaces.catalogs ?? {})) {
    pins.push(...sectionPins(manifestPath, `catalog:${name}`, catalog))
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

function lineViolations(lines: readonly DependencyLine[], all: readonly ManifestPin[]) {
  const specs = new Map<string, Set<string>>()
  for (const pin of all) {
    if (REFERENCE_SPEC.test(pin.spec)) continue
    specs.set(pin.package, (specs.get(pin.package) ?? new Set()).add(pin.spec))
  }
  return lines.flatMap((entry): PinViolation[] => {
    const pinned = specs.get(entry.package)
    const base = { package: entry.package, manifest: DEPENDENCIES_FILE, line: entry.line }
    if (!pinned) {
      return [
        {
          ...base,
          kind: 'unknown-line',
          message: `no manifest pins ${code(entry.package)}; remove its line`,
        },
      ]
    }
    if (pinned.has(entry.pin)) return []
    const current = [...pinned].map(code).join(', ')
    return [
      {
        ...base,
        kind: 'stale-line',
        message: `the line pins ${code(`${entry.package}@${entry.pin}`)} but the manifests pin ${current}; update or remove the line`,
      },
    ]
  })
}

async function changedPinViolation(
  pin: ManifestPin,
  lines: readonly DependencyLine[],
  latest: (name: string) => Promise<string | undefined>,
): Promise<PinViolation | undefined> {
  const base = { package: pin.package, manifest: pin.manifest, line: MANIFEST_LINE }
  const where = `${code(pin.package)} ${code(pin.spec)} in ${pin.section}`
  if (!EXACT_VERSION.test(pin.spec)) {
    return {
      ...base,
      kind: 'not-exact',
      message: `${where} is a range; pin an exact version (docs/dependency-updates.md)`,
    }
  }
  if (lines.some((entry) => entry.package === pin.package && entry.pin === pin.spec)) {
    return undefined
  }
  const newest = await latest(pin.package)
  if (newest === pin.spec) return undefined
  if (newest === undefined) {
    return {
      ...base,
      kind: 'latest-unknown',
      message: `${where} has no ${DEPENDENCIES_FILE} line and the registry's latest version could not be read; add a line or rerun online`,
    }
  }
  return {
    ...base,
    kind: 'missing-line',
    message: `${where} is not the latest release (${code(newest)}); add a ${DEPENDENCIES_FILE} line for ${code(`${pin.package}@${pin.spec}`)}`,
  }
}

/**
 * Changed pins that are ranges, changed pins behind `latest` without a line, lines whose version
 * no manifest pins any more, and lines for packages no manifest pins. `latest` is asked only about
 * changed exact pins without a line, so line findings need no network.
 */
export async function pinViolations(input: {
  readonly changed: readonly ManifestPin[]
  readonly all: readonly ManifestPin[]
  readonly lines: readonly DependencyLine[]
  readonly latest: (name: string) => Promise<string | undefined>
}): Promise<readonly PinViolation[]> {
  const changed = await Promise.all(
    input.changed
      .filter((pin) => !REFERENCE_SPEC.test(pin.spec))
      .map((pin) => changedPinViolation(pin, input.lines, input.latest)),
  )
  return [
    ...lineViolations(input.lines, input.all),
    ...changed.filter((violation) => violation !== undefined),
  ]
}
