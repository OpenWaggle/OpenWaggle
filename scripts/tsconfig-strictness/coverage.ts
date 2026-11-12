/**
 * Which source files the TypeScript projects check and how strictly (no-cheating/tsconfig), and
 * whether a change weakened that. A file's strictness is the strictest rank, flag by flag, of every project that
 * checks it. A change is weaker when a file checked before is no longer checked by any project
 * reachable from the root tsconfig.json, or when any file loses rank on any flag. Build outputs
 * and node_modules leaving the set are not weaker.
 */
import { type StrictnessRanks, STRICTNESS_FLAGS, strictest, strictnessRanks } from './flags'

export interface ProjectCoverage {
  /** Repository-relative path of the tsconfig file. */
  readonly config: string
  /** Repository-relative source files the project checks. */
  readonly files: readonly string[]
  readonly options: Readonly<Record<string, unknown>>
}

export type Coverage = ReadonlyMap<string, StrictnessRanks>

export interface Weakening {
  /** Files no project checks any more. */
  readonly droppedFiles: readonly string[]
  /** Per flag, the files that lost rank on it. */
  readonly droppedFlags: readonly { readonly flag: string; readonly files: readonly string[] }[]
}

/** Generated outputs and dependencies; their leaving a project is not weaker. */
const NOT_SOURCE = /(?:^|\/)(?:node_modules|dist|dist-cjs|\.pack|\.typecheck)\//u

export function isSourceFile(file: string) {
  return !NOT_SOURCE.test(file) && !file.startsWith('../')
}

export function coverageOf(projects: readonly ProjectCoverage[]): Coverage {
  const coverage = new Map<string, StrictnessRanks>()
  for (const project of projects) {
    const ranks = strictnessRanks(project.options)
    for (const file of project.files) {
      if (!isSourceFile(file)) continue
      const known = coverage.get(file)
      coverage.set(file, known === undefined ? ranks : strictest(known, ranks))
    }
  }
  return coverage
}

export function weakening(before: Coverage, after: Coverage): Weakening {
  const droppedFiles: string[] = []
  const droppedFlags = new Map<string, string[]>()
  for (const [file, was] of before) {
    const now = after.get(file)
    if (now === undefined) {
      droppedFiles.push(file)
      continue
    }
    for (const flag of STRICTNESS_FLAGS) {
      if ((now[flag] ?? 0) >= (was[flag] ?? 0)) continue
      const files = droppedFlags.get(flag) ?? []
      files.push(file)
      droppedFlags.set(flag, files)
    }
  }
  return {
    droppedFiles: droppedFiles.sort(),
    droppedFlags: [...droppedFlags].map(([flag, files]) => ({ flag, files: files.sort() })),
  }
}

export function isWeaker(change: Weakening) {
  return change.droppedFiles.length > 0 || change.droppedFlags.length > 0
}

/** Files named in one line: a few examples and the count. */
const EXAMPLES = 3

function examples(files: readonly string[]) {
  const shown = files.slice(0, EXAMPLES).join(', ')
  return files.length > EXAMPLES ? `${shown} and ${files.length - EXAMPLES} more` : shown
}

/** One message per dropped flag, and one for the files no project checks any more. */
export function weakeningMessages(change: Weakening): string[] {
  const files =
    change.droppedFiles.length === 0
      ? []
      : [
          `${change.droppedFiles.length} source file${change.droppedFiles.length === 1 ? '' : 's'} no longer type-checked by any project reachable from tsconfig.json: ${examples(change.droppedFiles)}`,
        ]
  // Flags weakened on the same files share a line: turning `strict` off weakens its whole family.
  const byFiles = new Map<string, { flags: string[]; files: readonly string[] }>()
  for (const { flag, files: weakened } of change.droppedFlags) {
    const key = weakened.join('\0')
    const group = byFiles.get(key) ?? { flags: [], files: weakened }
    group.flags.push(flag)
    byFiles.set(key, group)
  }
  const flags = [...byFiles.values()].map(
    ({ flags: names, files: weakened }) =>
      `${names.join(', ')} ${names.length === 1 ? 'checks' : 'check'} less on ${weakened.length} file${weakened.length === 1 ? '' : 's'}: ${examples(weakened)}`,
  )
  return [...files, ...flags]
}
