/**
 * Dependency checks for the manifests a Session changed: an added dependency needs the user's
 * approval (DEP-02), every changed pin is exact (DEP-01), and a changed pin that is not npm's
 * latest release needs a DEPENDENCIES.md row (DEP-03). A registry that cannot be reached is a
 * tool failure, so the manifest is checked again at the next gate.
 */
import {
  type ManifestPin,
  changedPins,
  manifestPins,
  parseDependencyRows,
  pinViolations,
} from '../dependency-pins/pins'
import type { DependencyCheck, PluginResult } from './gate'
import type { Finding, Severity, ToolFailure } from './findings'

const REGISTRY = 'https://registry.npmjs.org'
const ABBREVIATED = 'application/vnd.npm.install-v1+json'
const REGISTRY_TIMEOUT_MS = 4_000
const ROWS_FILE = 'DEPENDENCIES.md'

export type FetchLatest = (name: string) => Promise<string | undefined>

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** npm's `latest` dist-tag for a package, or undefined when the registry does not answer. */
export const fetchLatest: FetchLatest = async (name) => {
  try {
    const response = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}`, {
      headers: { accept: ABBREVIATED },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const document: unknown = await response.json()
    const tags = isRecord(document) ? document['dist-tags'] : undefined
    const latest = isRecord(tags) ? tags['latest'] : undefined
    return typeof latest === 'string' ? latest : undefined
  } catch {
    return undefined
  }
}

export interface DependencyCheckOptions {
  /** Whether the user approved adding this package at this spec. */
  readonly approved: (pin: ManifestPin) => boolean
  /** How an unapproved addition is reported; the manual check has no approvals to consult. */
  readonly unapproved?: Severity
  readonly latest?: FetchLatest
}

/** Pins that did not exist in the manifest before, by package name. */
export function addedPins(before: readonly ManifestPin[], after: readonly ManifestPin[]) {
  const existing = new Set(before.map((pin) => pin.package))
  return after.filter((pin) => !existing.has(pin.package))
}

function approvalFinding(pin: ManifestPin, severity: Severity): Finding {
  return {
    file: pin.manifest,
    rule: 'gate/dependencies',
    id: 'DEP-02',
    message: `${pin.package}@${pin.spec} added without the user's approval; ask the user or remove it`,
    severity,
  }
}

export function dependencyCheck(options: DependencyCheckOptions): DependencyCheck {
  const latest = options.latest ?? fetchLatest
  return async ({ manifests, baseline, text }): Promise<PluginResult> => {
    const pins = await Promise.all(
      manifests.map(async (manifest) => ({
        before: manifestPins(manifest, (await baseline.text(manifest)) ?? '{}'),
        after: manifestPins(manifest, (await text(manifest)) ?? '{}'),
      })),
    )
    const changed = pins.flatMap(({ before, after }) => changedPins(before, after))
    const added = pins.flatMap(({ before, after }) => addedPins(before, after))
    const { rows } = parseDependencyRows((await text(ROWS_FILE)) ?? '')
    const violations = await pinViolations({
      changed,
      all: pins.flatMap(({ after }) => after),
      rows,
      latest,
    })
    const changedNames = new Set(changed.map((pin) => pin.package))
    const findings: Finding[] = [
      ...added
        .filter((pin) => !options.approved(pin))
        .map((pin) => approvalFinding(pin, options.unapproved ?? 'block')),
      ...violations
        .filter(
          (violation) => violation.kind !== 'latest-unknown' && changedNames.has(violation.package),
        )
        .map((violation) => ({
          file: violation.kind === 'not-exact' ? violation.manifest : ROWS_FILE,
          rule: `gate/dependencies`,
          id: violation.kind === 'not-exact' ? 'DEP-01' : 'DEP-03',
          message: violation.message.replace(/\s*\[DEP-0\d\]$/u, ''),
          severity: 'block' as const,
        })),
    ]
    const unknown = violations.filter((violation) => violation.kind === 'latest-unknown')
    const failures: ToolFailure[] =
      unknown.length === 0
        ? []
        : [
            {
              check: 'dependencies',
              files: [...new Set(unknown.map((violation) => violation.manifest))],
              reason: `npm registry unreachable for ${unknown.map((violation) => violation.package).join(', ')}`,
            },
          ]
    return { findings, failures }
  }
}
