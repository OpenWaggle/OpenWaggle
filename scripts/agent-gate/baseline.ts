/**
 * What a file held when the Session started, the reference for new suppressions, added
 * dependencies and weakened tsconfigs. Files that were already dirty are read at the start; the
 * rest come from the starting `HEAD`, so a commit during the Session does not move the baseline.
 * The manual check uses a git ref instead.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { isSuppressionCandidate } from './suppressions'
import type { WorkspaceSnapshot } from '../agent-quality-gates/changed-files'
import type { RunProcess } from '../agent-quality-gates/process'
import { git } from './git'
import { TSCONFIG_FILE } from './tsconfig-strictness'

export interface Baseline {
  /** The file's text at the baseline, or undefined when it did not exist then. */
  readonly text: (file: string) => Promise<string | undefined>
}

const GIT_SHOW_TIMEOUT_MS = 10_000
const MAX_BASELINE_BYTES = 2 * 1024 * 1024
const MANIFEST = /(?:^|\/)package\.json$/u

function needsBaseline(file: string) {
  return isSuppressionCandidate(file) || MANIFEST.test(file) || TSCONFIG_FILE.test(file)
}

/** The file's text at `ref`, or undefined when it was not there. */
export function textAtRef(run: RunProcess, root: string, ref: string, file: string) {
  return git(run, root, ['show', `${ref}:${file}`], GIT_SHOW_TIMEOUT_MS)
}

export function baselineAtRef(run: RunProcess, root: string, ref: string): Baseline {
  return { text: (file) => textAtRef(run, root, ref, file) }
}

/** Records the Session-start baseline from the snapshot taken when it started. */
export async function captureBaseline(
  run: RunProcess,
  root: string,
  start: WorkspaceSnapshot,
): Promise<Baseline> {
  const dirty = new Map<string, string | undefined>()
  await Promise.all(
    [...start.dirty.keys()].filter(needsBaseline).map(async (file) => {
      const text = await readFile(path.join(root, file), 'utf8').catch(() => undefined)
      dirty.set(file, text !== undefined && text.length <= MAX_BASELINE_BYTES ? text : undefined)
    }),
  )
  return {
    text: (file) =>
      dirty.has(file)
        ? Promise.resolve(dirty.get(file))
        : start.head === ''
          ? Promise.resolve(undefined)
          : textAtRef(run, root, start.head, file),
  }
}
