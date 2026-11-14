import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  type LockedVersion,
  type PackageProvenance,
  evaluateProvenanceDowngrades,
  isProvenanceCandidate,
  parseAbbreviatedPackument,
  parsePublishTimes,
  type ProvenanceEvaluation,
} from './provenance-downgrade'
import {
  PROVENANCE_DOWNGRADE_EXCEPTIONS,
  PROVENANCE_DOWNGRADE_WINDOW_DAYS,
  type ProvenanceDowngradeException,
} from './provenance-downgrade-policy'
import { BUN_LOCKFILE, parseBunLockfile } from './support/bun-workspace'
import { Schema } from '@shared/schema'
import { objectEntries, objectFields, unknownField } from './support/object-fields'

/**
 * Fails when a locked package version lost the npm provenance its earlier versions had, the check
 * pnpm's `trustPolicy: no-downgrade` ran on every install. A release that stops carrying
 * provenance is what a hijacked maintainer account or a stolen token publishing outside the
 * package's CI looks like. Versions older than the policy window and the reviewed exceptions in
 * scripts/provenance-downgrade-policy.ts pass.
 *
 * Published versions never change, so registry answers are cached in
 * node_modules/.cache/openwaggle and refetched only for a package whose cached answer does not
 * list a locked version yet.
 */

const REGISTRY = 'https://registry.npmjs.org'
const CACHE_FILE = 'node_modules/.cache/openwaggle/provenance-downgrade-v1.json'
const CONCURRENCY = 12
const ATTEMPTS = 3
const RETRY_DELAY_MS = 250
const FIRST_SERVER_ERROR_STATUS = 500
const TOO_MANY_REQUESTS_STATUS = 429
const ABBREVIATED = 'application/vnd.npm.install-v1+json'

interface ProvenanceCache {
  readonly packages: Record<string, PackageProvenance>
}

export interface RegistryClient {
  /** The parsed JSON document for a package, abbreviated or full. */
  readonly fetchPackument: (name: string, abbreviated: boolean) => Promise<unknown>
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

export function packumentUrl(name: string, registry = REGISTRY) {
  return `${registry}/${name.replace('/', '%2f')}`
}

export function createRegistryClient(fetchImpl: typeof fetch = fetch, registry = REGISTRY) {
  const client: RegistryClient = {
    async fetchPackument(name, abbreviated) {
      let lastError: unknown
      for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        try {
          const response = await fetchImpl(packumentUrl(name, registry), {
            headers: { accept: abbreviated ? ABBREVIATED : 'application/json' },
          })
          if (response.ok) {
            const document: unknown = await response.json()
            return document
          }
          lastError = new Error(`${response.status} ${response.statusText}`)
          if (
            response.status < FIRST_SERVER_ERROR_STATUS &&
            response.status !== TOO_MANY_REQUESTS_STATUS
          ) {
            break
          }
        } catch (error) {
          lastError = error
        }
        if (attempt < ATTEMPTS) await delay(RETRY_DELAY_MS * attempt)
      }
      const reason = lastError instanceof Error ? lastError.message : String(lastError)
      throw new Error(`Could not read the registry metadata for ${name}: ${reason}`)
    },
  }
  return client
}

const provenanceCacheSchema = Schema.Struct({ packages: unknownField })
const cachedPackageSchema = Schema.Struct({ versions: unknownField, published: unknownField })

export function parseProvenanceCache(text: string) {
  const cached = objectFields(provenanceCacheSchema, JSON.parse(text))?.packages
  const packages: Record<string, PackageProvenance> = {}
  for (const [name, value] of objectEntries(cached) ?? []) {
    const entry = objectFields(cachedPackageSchema, value)
    const versionEntries = objectEntries(entry?.versions)
    const publishedEntries = objectEntries(entry?.published)
    if (versionEntries === undefined || publishedEntries === undefined) continue
    const versions = Object.fromEntries(
      versionEntries.filter((item): item is [string, boolean] => typeof item[1] === 'boolean'),
    )
    const published = Object.fromEntries(
      publishedEntries.filter((item): item is [string, string] => typeof item[1] === 'string'),
    )
    packages[name] = { versions, published }
  }
  const cache: ProvenanceCache = { packages }
  return cache
}

async function readCache(file: string) {
  try {
    return parseProvenanceCache(await readFile(file, 'utf8'))
  } catch {
    const cache: ProvenanceCache = { packages: {} }
    return cache
  }
}

/**
 * Keeps what a later run can reuse: each package's attested versions, which later locked versions
 * are compared against, and the locked versions themselves. A newly locked version is absent, so
 * its package is fetched again.
 */
export function compactProvenanceCache(cache: ProvenanceCache, locked: readonly LockedVersion[]) {
  const lockedByName = new Map<string, Set<string>>()
  for (const entry of locked) {
    lockedByName.set(entry.name, (lockedByName.get(entry.name) ?? new Set()).add(entry.version))
  }
  const packages: Record<string, PackageProvenance> = {}
  for (const [name, versions] of lockedByName) {
    const entry = cache.packages[name]
    if (!entry) continue
    packages[name] = {
      versions: Object.fromEntries(
        Object.entries(entry.versions).filter(
          ([version, attested]) => attested || versions.has(version),
        ),
      ),
      // Publish times of the versions kept above; earlier attested times decide a downgrade.
      published: Object.fromEntries(
        Object.entries(entry.published).filter(
          ([version]) => versions.has(version) || entry.versions[version],
        ),
      ),
    }
  }
  const result: ProvenanceCache = { packages }
  return result
}

async function writeCache(file: string, cache: ProvenanceCache) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(cache)}\n`)
  await rename(temporary, file)
}

async function mapConcurrently<T>(items: readonly T[], work: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      if (item !== undefined) await work(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
}

/** Unique registry `name@version` pairs of a `bun.lock`, sorted for stable output. */
export function lockedRegistryVersions(lockfileText: string) {
  const unique = new Map<string, LockedVersion>()
  for (const entry of parseBunLockfile(lockfileText).packages) {
    unique.set(`${entry.name}@${entry.version}`, { name: entry.name, version: entry.version })
  }
  const result: LockedVersion[] = [...unique.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([, entry]) => entry)
  return result
}

export interface ProvenanceCheckResult extends ProvenanceEvaluation {
  readonly checked: number
  readonly fetched: number
}

/**
 * Loads provenance for every locked version, from the cache where it is complete, and evaluates
 * it. `cache.packages` is updated in place with whatever was fetched.
 */
export async function checkProvenanceDowngrades(input: {
  readonly locked: readonly LockedVersion[]
  readonly cache: ProvenanceCache
  readonly client: RegistryClient
  readonly exceptions: readonly ProvenanceDowngradeException[]
  readonly now: Date
  readonly windowDays: number
}) {
  const versionsByName = new Map<string, string[]>()
  for (const entry of input.locked) {
    versionsByName.set(entry.name, [...(versionsByName.get(entry.name) ?? []), entry.version])
  }
  const stale = [...versionsByName.entries()]
    .filter(([name, versions]) => {
      const cached = input.cache.packages[name]
      return !cached || versions.some((version) => cached.versions[version] === undefined)
    })
    .map(([name]) => name)

  let fetched = 0
  await mapConcurrently(stale, async (name) => {
    const document = await input.client.fetchPackument(name, true)
    input.cache.packages[name] = {
      versions: parseAbbreviatedPackument(document, name),
      published: input.cache.packages[name]?.published ?? {},
    }
    fetched += 1
  })

  const timeNames = [
    ...new Set(
      input.locked
        .filter((entry) => {
          const cached = input.cache.packages[entry.name]
          return (
            isProvenanceCandidate(cached, entry.version) &&
            cached?.published[entry.version] === undefined
          )
        })
        .map((entry) => entry.name),
    ),
  ]
  await mapConcurrently(timeNames, async (name) => {
    const times = parsePublishTimes(await input.client.fetchPackument(name, false), name)
    const cached = input.cache.packages[name]
    if (!cached) return
    const published = Object.fromEntries(
      Object.entries(times).filter(([version]) => cached.versions[version] !== undefined),
    )
    input.cache.packages[name] = { ...cached, published }
    fetched += 1
  })

  const evaluation = evaluateProvenanceDowngrades({
    locked: input.locked,
    provenance: new Map(Object.entries(input.cache.packages)),
    exceptions: input.exceptions,
    now: input.now,
    windowDays: input.windowDays,
  })
  const result: ProvenanceCheckResult = { ...evaluation, checked: input.locked.length, fetched }
  return result
}

/** The failure lines, empty when the check passes. */
export function formatProvenanceFailures(result: ProvenanceEvaluation, windowDays: number) {
  const lines: string[] = []
  for (const entry of result.violations) {
    lines.push(
      `${entry.name}@${entry.version} has no npm provenance, but ${entry.name}@${entry.lastAttestedVersion} did, ` +
        `and it was published less than ${windowDays} days ago. Pin an attested version, or review it and add an exception ` +
        'with its reason to scripts/provenance-downgrade-policy.ts.',
    )
  }
  for (const entry of result.missing) {
    lines.push(
      `${entry.name}@${entry.version} is locked in ${BUN_LOCKFILE} but the registry does not list it ` +
        'with a publish time.',
    )
  }
  for (const exception of result.staleExceptions) {
    lines.push(
      `The provenance exception for ${exception.package} matches no locked downgrade; remove it from ` +
        'scripts/provenance-downgrade-policy.ts.',
    )
  }
  return lines
}

async function main() {
  const root = process.cwd()
  const cacheFile = path.join(root, CACHE_FILE)
  const cache = await readCache(cacheFile)
  const locked = lockedRegistryVersions(await readFile(path.join(root, BUN_LOCKFILE), 'utf8'))
  const result = await checkProvenanceDowngrades({
    locked,
    cache,
    client: createRegistryClient(),
    exceptions: PROVENANCE_DOWNGRADE_EXCEPTIONS,
    now: new Date(),
    windowDays: PROVENANCE_DOWNGRADE_WINDOW_DAYS,
  })
  if (result.fetched > 0) await writeCache(cacheFile, compactProvenanceCache(cache, locked))

  const failures = formatProvenanceFailures(result, PROVENANCE_DOWNGRADE_WINDOW_DAYS)
  if (failures.length > 0) {
    for (const line of failures) console.error(line)
    process.exitCode = 1
    return
  }
  console.log(
    `Provenance: ${result.checked} locked versions, none lost provenance ` +
      `(${result.excepted.length} reviewed, ${result.aged.length} older than ${PROVENANCE_DOWNGRADE_WINDOW_DAYS} days).`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
