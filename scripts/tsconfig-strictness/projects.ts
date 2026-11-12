/**
 * Loads the TypeScript projects reachable from the root tsconfig.json through `references`, with
 * TypeScript's own config resolution (extends, include, exclude, files) from the
 * `typescript/unstable/async` API. Config files are read from a given map instead of the disk, so
 * the same source tree can be checked under the configs of another commit. Results are cached by
 * a hash of those configs and of the repository's file list.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { API } from 'typescript/unstable/async'
import type { ProjectCoverage } from './coverage'
import { Schema } from '@shared/schema'
import { objectFields, unknownField } from '../support/object-fields'

export const TSCONFIG_FILE = /(?:^|\/)tsconfig[^/]*\.json$/u
export const ROOT_CONFIG = 'tsconfig.json'
const CACHE_FILE = 'node_modules/.cache/openwaggle/tsconfig-coverage-v1.json'
const CACHE_ENTRIES = 6
const LOAD_TIMEOUT_MS = 60_000

/** Repository-relative config path to its text, or null when the file does not exist. */
export type ConfigTexts = ReadonlyMap<string, string | null>

/** A string, kept, or a comment, dropped. */
const STRING_OR_COMMENT = /"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//gu
/** A string, kept, or a comma before a closing bracket, dropped. */
const STRING_OR_TRAILING_COMMA = /"(?:[^"\\]|\\.)*"|,(?=\s*[}\]])/gu

/** JSON with comments and trailing commas, as tsconfig files allow. */
export function parseJsonc(text: string) {
  const keepStrings = (match: string) => (match.startsWith('"') ? match : '')
  const result: unknown = JSON.parse(
    text.replace(STRING_OR_COMMENT, keepStrings).replace(STRING_OR_TRAILING_COMMA, keepStrings),
  )
  return result
}

function toRelative(root: string, file: string) {
  return path.relative(root, file).split(path.sep).join('/')
}

const referencesSchema = Schema.Struct({ references: unknownField })
const referenceSchema = Schema.Struct({ path: unknownField })

/** The configs a config's `references` name, repository-relative. */
export function referencedConfigs(config: string, text: string) {
  const parsed = parseJsonc(text)
  const references = objectFields(referencesSchema, parsed)?.references
  if (!Array.isArray(references)) {
    const result: string[] = []
    return result
  }
  const result: string[] = references.flatMap((reference: unknown) => {
    const target = objectFields(referenceSchema, reference)?.path
    if (typeof target !== 'string') return []
    const joined = path.posix.normalize(path.posix.join(path.posix.dirname(config), target))
    return [joined.endsWith('.json') ? joined : path.posix.join(joined, ROOT_CONFIG)]
  })
  return result
}

function cacheKey(configs: ConfigTexts, listing: string) {
  const hash = createHash('sha256')
  for (const [file, text] of [...configs].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(`${file}\0${text ?? '\u0001'}\0`)
  }
  return hash.update(listing).digest('hex')
}

interface CacheEntry {
  readonly key: string
  readonly projects: readonly ProjectCoverage[]
}

const cacheFileSchema = Schema.Struct({ entries: unknownField })
/** A cache entry: its key and a projects list, trusted as written by `writeCache`. */
const cacheEntrySchema = Schema.Struct({
  key: Schema.String,
  projects: Schema.Array(Schema.Unknown),
})

async function readCache(root: string) {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(root, CACHE_FILE), 'utf8'))
    const entries = objectFields(cacheFileSchema, parsed)?.entries
    const entry: CacheEntry[] = Array.isArray(entries) ? entries.filter(isCacheEntry) : []
    return entry
  } catch {
    const entry: CacheEntry[] = []
    return entry
  }
}

function isCacheEntry(value: unknown): value is CacheEntry {
  return objectFields(cacheEntrySchema, value) !== undefined
}

async function writeCache(root: string, entries: readonly CacheEntry[]) {
  const file = path.join(root, CACHE_FILE)
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify({ entries: entries.slice(0, CACHE_ENTRIES) }))
  await rename(temporary, file)
}

async function withTimeout<T>(work: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${milliseconds} ms`)), milliseconds)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function parseProjects(root: string, configs: ConfigTexts) {
  // TypeScript asks for real paths (macOS /tmp is /private/tmp), so map both spellings.
  const real = await realpath(root)
  const absolute = new Map(
    [...configs].flatMap(([file, text]) => [
      [path.join(root, file), text] as const,
      [path.join(real, file), text] as const,
    ]),
  )
  const api = new API({
    cwd: real,
    // A config in the map is read from it, null meaning missing; anything else from the disk.
    fs: { readFile: (file) => absolute.get(path.resolve(file)) },
  })
  try {
    const projects: ProjectCoverage[] = []
    const pending = [ROOT_CONFIG]
    const seen = new Set<string>()
    while (pending.length > 0) {
      const config = pending.shift() ?? ROOT_CONFIG
      if (seen.has(config)) continue
      seen.add(config)
      const text = configs.get(config)
      if (text === null || text === undefined) continue
      const parsed = await api.parseConfigFile(path.join(real, config))
      projects.push({
        config,
        files: parsed.fileNames.map((file) => toRelative(real, file)),
        options: parsed.options,
      })
      pending.push(...referencedConfigs(config, text))
    }
    return projects
  } finally {
    await api.close()
  }
}

const memory = new Map<string, readonly ProjectCoverage[]>()

/**
 * The projects reachable from tsconfig.json under `configs`. `listing` is the repository's file
 * list (any stable text); a new or removed file changes the cache key.
 */
export async function loadProjects(root: string, configs: ConfigTexts, listing: string) {
  const key = cacheKey(configs, listing)
  const remembered = memory.get(key)
  if (remembered !== undefined) return remembered
  const cached = await readCache(root)
  const hit = cached.find((entry) => entry.key === key)
  if (hit !== undefined) {
    memory.set(key, hit.projects)
    return hit.projects
  }
  const projects = await withTimeout(parseProjects(root, configs), LOAD_TIMEOUT_MS)
  memory.set(key, projects)
  await writeCache(root, [{ key, projects }, ...cached.filter((entry) => entry.key !== key)]).catch(
    () => undefined,
  )
  const coverage: readonly ProjectCoverage[] = projects
  return coverage
}
