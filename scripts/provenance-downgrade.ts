/**
 * The pure half of the provenance downgrade check (scripts/check-provenance-downgrade.ts). Bun
 * has no equivalent of pnpm's `trustPolicy: no-downgrade`, so this decides, from registry
 * metadata, which locked versions shipped without the npm provenance an earlier version had.
 */

import type { ProvenanceDowngradeException } from './provenance-downgrade-policy'
import { Schema } from '@shared/schema'
import { objectEntries, objectFields, unknownField } from './support/object-fields'

/** What the check needs from one package's registry metadata. */
export interface PackageProvenance {
  /** Version to whether it was published with an npm provenance attestation. */
  readonly versions: Readonly<Record<string, boolean>>
  /** Version to its publish time (ISO 8601), known only for versions that needed it. */
  readonly published: Readonly<Record<string, string>>
}

export interface LockedVersion {
  readonly name: string
  readonly version: string
}

/** A locked version without provenance whose earlier version had it. */
export interface ProvenanceDowngrade extends LockedVersion {
  /** The last version published with provenance before it. */
  readonly lastAttestedVersion: string
}

export interface ProvenanceEvaluation {
  readonly violations: readonly ProvenanceDowngrade[]
  /** Downgrades older than the window, which are treated as established. */
  readonly aged: readonly ProvenanceDowngrade[]
  /** Downgrades a reviewed exception covers. */
  readonly excepted: readonly ProvenanceDowngrade[]
  /** Exceptions that no locked downgrade needs any more. */
  readonly staleExceptions: readonly ProvenanceDowngradeException[]
  /** Locked versions the registry does not list, or lists without a publish time. */
  readonly missing: readonly LockedVersion[]
}

const DAY_MS = 86_400_000
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const packumentVersionsSchema = Schema.Struct({ versions: unknownField })
const packumentTimeSchema = Schema.Struct({ time: unknownField })
/** A packument version whose `dist.attestations.provenance` is an object. */
const attestedManifestSchema = Schema.Struct({
  dist: Schema.Struct({ attestations: Schema.Struct({ provenance: Schema.Object }) }),
})

/**
 * Which versions of an abbreviated packument (`Accept: application/vnd.npm.install-v1+json`)
 * carry an npm provenance attestation in `dist.attestations`.
 */
export function parseAbbreviatedPackument(
  document: unknown,
  name: string,
): Record<string, boolean> {
  const packumentVersions = objectFields(packumentVersionsSchema, document)?.versions
  const versionEntries = objectEntries(packumentVersions)
  if (versionEntries === undefined) {
    throw new Error(`The registry metadata for ${name} has no versions object.`)
  }
  const versions: Record<string, boolean> = {}
  for (const [version, manifest] of versionEntries) {
    versions[version] = Schema.is(attestedManifestSchema)(manifest)
  }
  return versions
}

/** The publish times of the full packument, by version. */
export function parsePublishTimes(document: unknown, name: string): Record<string, string> {
  const timeEntries = objectEntries(objectFields(packumentTimeSchema, document)?.time)
  if (timeEntries === undefined) {
    throw new Error(`The registry metadata for ${name} has no time object.`)
  }
  return Object.fromEntries(
    timeEntries.filter(
      (entry): entry is [string, string] => VERSION.test(entry[0]) && typeof entry[1] === 'string',
    ),
  )
}

/**
 * A locked version that could be a downgrade: it has no provenance and some version of the
 * package has. Only these need publish times, which only the full packument carries.
 */
export function isProvenanceCandidate(metadata: PackageProvenance | undefined, version: string) {
  if (metadata?.versions[version] !== false) return false
  return Object.values(metadata.versions).some(Boolean)
}

const PRERELEASE = /^\d+\.\d+\.\d+-/

/**
 * The most recently published attested version that was published before `version`, when
 * `version` itself has no provenance. Earlier means earlier in time, as in pnpm's
 * `trustPolicy: no-downgrade`, and a stable version is compared only with stable ones, so an
 * attested canary or placeholder prerelease does not make every stable release a downgrade. A
 * backport published after an attested major is a downgrade by this rule; the time window or a
 * reviewed exception lets it through.
 */
export function findProvenanceDowngrade(
  metadata: PackageProvenance,
  version: string,
): string | undefined {
  if (metadata.versions[version] !== false) return undefined
  const lockedTime = Date.parse(metadata.published[version] ?? '')
  const stableOnly = !PRERELEASE.test(version)
  let lastAttested: { readonly version: string; readonly time: number } | undefined
  for (const [candidate, attested] of Object.entries(metadata.versions)) {
    if (!attested || (stableOnly && PRERELEASE.test(candidate))) continue
    const time = Date.parse(metadata.published[candidate] ?? '')
    if (!Number.isFinite(time) || time >= lockedTime) continue
    if (lastAttested === undefined || time > lastAttested.time) {
      lastAttested = { version: candidate, time }
    }
  }
  return lastAttested?.version
}

function exceptionCovers(exception: ProvenanceDowngradeException, locked: LockedVersion) {
  return (
    exception.package === locked.name || exception.package === `${locked.name}@${locked.version}`
  )
}

export function evaluateProvenanceDowngrades(input: {
  readonly locked: readonly LockedVersion[]
  readonly provenance: ReadonlyMap<string, PackageProvenance>
  readonly exceptions: readonly ProvenanceDowngradeException[]
  readonly now: Date
  readonly windowDays: number
}): ProvenanceEvaluation {
  const violations: ProvenanceDowngrade[] = []
  const aged: ProvenanceDowngrade[] = []
  const excepted: ProvenanceDowngrade[] = []
  const missing: LockedVersion[] = []
  const usedExceptions = new Set<ProvenanceDowngradeException>()
  const cutoff = input.now.getTime() - input.windowDays * DAY_MS

  for (const entry of input.locked) {
    const metadata = input.provenance.get(entry.name)
    const isCandidate = isProvenanceCandidate(metadata, entry.version)
    if (
      metadata?.versions[entry.version] === undefined ||
      (isCandidate && !metadata.published[entry.version])
    ) {
      missing.push(entry)
      continue
    }
    if (!isCandidate) continue
    const lastAttestedVersion = findProvenanceDowngrade(metadata, entry.version)
    if (lastAttestedVersion === undefined) continue
    const downgrade = { ...entry, lastAttestedVersion }
    const exception = input.exceptions.find((exception) => exceptionCovers(exception, entry))
    if (exception) {
      usedExceptions.add(exception)
      excepted.push(downgrade)
      continue
    }
    if (Date.parse(metadata.published[entry.version] ?? '') < cutoff) aged.push(downgrade)
    else violations.push(downgrade)
  }

  return {
    violations,
    aged,
    excepted,
    staleExceptions: input.exceptions.filter((exception) => !usedExceptions.has(exception)),
    missing,
  }
}
