import { execFile as execFileCallback } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { createRegistryClient, type RegistryClient } from './check-provenance-downgrade'
import {
  changedPins,
  DEPENDENCIES_FILE,
  formatPinFinding,
  type ManifestPin,
  manifestPins,
  parseDependencyLines,
  pinViolations,
} from './dependency-pins/pins'
import { parseBaseArgument, resolveBase } from './support/git-base'
import { Schema } from '@shared/schema'
import { objectEntries, objectFields, unknownField } from './support/object-fields'

/**
 * `bun scripts/check-dependency-pins.ts [--base <ref>]`. Compares the manifests with those at
 * the base ref (the merge base with origin/main by default), asks the npm registry for the
 * `latest` release of each changed pin without a DEPENDENCIES.md line, and checks every line
 * against the current manifests. Line checks need no network; registry answers are cached in
 * node_modules/.cache/openwaggle for a few hours, since `latest` moves.
 */

const execFile = promisify(execFileCallback)
const CACHE_FILE = 'node_modules/.cache/openwaggle/dependency-pins-latest-v1.json'
const HOURS_CACHED = 6
const MS_PER_HOUR = 3_600_000
const CACHE_TTL_MS = HOURS_CACHED * MS_PER_HOUR
const WORKSPACE_DIRECTORIES = ['packages', 'tools'] as const
const ROOT_MANIFESTS = ['package.json', 'website/package.json'] as const
/** `process.argv` holds the runtime and the script path before the arguments. */
const FIRST_ARGUMENT = 2
const GIT_OUTPUT_LIMIT = 64 * 1024 * 1024

interface CachedLatest {
  readonly latest: string
  readonly checkedAt: number
}

type LatestCache = Record<string, CachedLatest>

const cachedLatestSchema = Schema.Struct({ latest: Schema.String, checkedAt: Schema.Number })
const distTagsDocumentSchema = Schema.Struct({ 'dist-tags': unknownField })
const latestTagSchema = Schema.Struct({ latest: unknownField })

async function git(root: string, args: readonly string[]) {
  const { stdout } = await execFile('git', [...args], { cwd: root, maxBuffer: GIT_OUTPUT_LIMIT })
  return stdout
}

/** The root, website, `packages/*` and `tools/*` manifests in the working tree. */
async function manifestPaths(root: string) {
  const nested = await Promise.all(
    WORKSPACE_DIRECTORIES.map(async (directory) => {
      const entries = await readdir(path.join(root, directory), { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${directory}/${entry.name}/package.json`)
        .filter((file) => existsSync(path.join(root, file)))
    }),
  )
  return [...ROOT_MANIFESTS, ...nested.flat()].sort()
}

async function currentPins(root: string, files: readonly string[]) {
  const pins = await Promise.all(
    files.map(async (file) => manifestPins(file, await readFile(path.join(root, file), 'utf8'))),
  )
  return pins.flat()
}

async function basePins(root: string, ref: string, files: readonly string[]) {
  const listed = await git(root, ['ls-tree', '--name-only', ref, '--', ...files])
  const present = listed.split('\n').filter((file) => file.length > 0)
  const pins = await Promise.all(
    present.map(async (file) => manifestPins(file, await git(root, ['show', `${ref}:${file}`]))),
  )
  return pins.flat()
}

async function readLatestCache(file: string): Promise<LatestCache> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return {}
  }
  const cache: LatestCache = {}
  for (const [name, entry] of objectEntries(JSON.parse(text)) ?? []) {
    const cached = objectFields(cachedLatestSchema, entry)
    if (cached !== undefined) cache[name] = { latest: cached.latest, checkedAt: cached.checkedAt }
  }
  return cache
}

async function writeLatestCache(file: string, cache: LatestCache) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(cache)}\n`)
  await rename(temporary, file)
}

/** `dist-tags.latest` of an abbreviated packument. */
export function latestDistTag(document: unknown) {
  const distTags = objectFields(distTagsDocumentSchema, document)?.['dist-tags']
  const latest = objectFields(latestTagSchema, distTags)?.latest
  return typeof latest === 'string' ? latest : undefined
}

/**
 * A `latest` lookup backed by the cache. A registry failure answers undefined, which the check
 * reports as `latest-unknown`, and prints why once per package.
 */
export function cachedLatest(input: {
  readonly cache: LatestCache
  readonly client: RegistryClient
  readonly now: number
}) {
  const pending = new Map<string, Promise<string | undefined>>()
  const lookup = async (name: string) => {
    const cached = input.cache[name]
    if (cached && input.now - cached.checkedAt < CACHE_TTL_MS) return cached.latest
    try {
      const latest = latestDistTag(await input.client.fetchPackument(name, true))
      if (latest) input.cache[name] = { latest, checkedAt: input.now }
      return latest
    } catch (error) {
      console.warn(`dependency-pins: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }
  return (name: string) => {
    const existing = pending.get(name)
    if (existing) return existing
    const request = lookup(name)
    pending.set(name, request)
    return request
  }
}

async function main() {
  const root = process.cwd()
  const base = await resolveBase(
    root,
    parseBaseArgument(process.argv.slice(FIRST_ARGUMENT)),
    'dependency-pins',
  )
  const files = await manifestPaths(root)
  const [all, before] = await Promise.all([currentPins(root, files), basePins(root, base, files)])
  const changed: readonly ManifestPin[] = changedPins(before, all)
  const pinLines = parseDependencyLines(await readFile(path.join(root, DEPENDENCIES_FILE), 'utf8'))

  const cacheFile = path.join(root, CACHE_FILE)
  const cache = await readLatestCache(cacheFile)
  const cacheBefore = JSON.stringify(cache)
  const latest = cachedLatest({ cache, client: createRegistryClient(), now: Date.now() })
  const violations = await pinViolations({ changed, all, lines: pinLines.lines, latest })
  if (JSON.stringify(cache) !== cacheBefore) await writeLatestCache(cacheFile, cache)

  const lines = [
    ...pinLines.findings.map((finding) =>
      formatPinFinding({ file: DEPENDENCIES_FILE, ...finding }),
    ),
    ...violations.map((violation) => formatPinFinding({ file: violation.manifest, ...violation })),
  ]
  if (lines.length === 0) {
    console.log(
      `dependency-pins: ${pinLines.lines.length} lines, ${changed.length} changed pins, no problems`,
    )
    return
  }
  for (const line of lines) console.error(line)
  process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
