/**
 * no-cheating/tsconfig by effect: the projects reachable from tsconfig.json under the configs
 * before a change and after it, both over today's source tree, so a deleted source file does not count as
 * dropped. Callers give the file list and how to read each side's configs.
 */
import { coverageOf, weakening, type Weakening, type ProjectCoverage } from './coverage'
import { TSCONFIG_FILE, loadProjects } from './projects'

export interface ConfigComparison {
  readonly root: string
  /** `git ls-files -co --exclude-standard -z` output: today's files. */
  readonly listing: string
  /** Config paths that may have existed before but not now, such as deleted ones. */
  readonly extraConfigs?: readonly string[]
  readonly before: (file: string) => Promise<string | undefined>
  readonly after: (file: string) => Promise<string | undefined>
}

export interface ComparisonResult {
  readonly weakening: Weakening
  readonly before: readonly ProjectCoverage[]
  readonly after: readonly ProjectCoverage[]
}

/** Every tsconfig file in the listing and in `extra`. */
export function configCandidates(listing: string, extra: readonly string[] = []) {
  const listed = listing.split(/[\0\n]/u).filter((file) => TSCONFIG_FILE.test(file))
  return [...new Set([...listed, ...extra.filter((file) => TSCONFIG_FILE.test(file))])].sort()
}

async function texts(
  candidates: readonly string[],
  read: (file: string) => Promise<string | undefined>,
) {
  const entries = await Promise.all(
    candidates.map(async (file) => [file, (await read(file)) ?? null] as const),
  )
  return new Map(entries)
}

export async function compareConfigs(input: ConfigComparison) {
  const candidates = configCandidates(input.listing, input.extraConfigs)
  const [beforeTexts, afterTexts] = await Promise.all([
    texts(candidates, input.before),
    texts(candidates, input.after),
  ])
  const [before, after] = await Promise.all([
    loadProjects(input.root, beforeTexts, input.listing),
    loadProjects(input.root, afterTexts, input.listing),
  ])
  const result: ComparisonResult = {
    weakening: weakening(coverageOf(before), coverageOf(after)),
    before,
    after,
  }
  return result
}
