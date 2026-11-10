/**
 * Runs Fallow and React Doctor for the files an agent changed, and returns their findings in
 * those files. Both tools analyze the whole project graph (an unused export is only unused
 * relative to every importer), then the report is narrowed to the changed files. A tool that is
 * not installed, times out, or prints no report contributes nothing: the `check` gate and CI
 * still run it.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  type Finding,
  deadCodeFindings,
  duplicationFindings,
  reactDoctorFindings,
} from './findings'
import type { RunProcess } from './process'

export interface QualityGateRun {
  readonly root: string
  /** Changed files, relative to `root`. */
  readonly files: readonly string[]
  readonly run: RunProcess
  readonly signal?: AbortSignal
}

const TOOL_TIMEOUT_MS = 120_000
// Each tool gets a bounded share of the machine so an agent turn never saturates it.
const FALLOW_THREADS = '4'
const REACT_DOCTOR_WORKERS = '2'
const FALLOW_FILES = /(?:\.[cm]?[jt]sx?|\.json|\.jsonc|\.vue|\.svelte|\.astro|\.mdx|\.css|\.scss)$/
const REACT_DOCTOR_FILES = /\.[cm]?[jt]sx?$/

function binary(root: string, name: string) {
  const file = path.join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name,
  )
  return existsSync(file) ? file : undefined
}

async function report(
  input: QualityGateRun,
  tool: string | undefined,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
) {
  if (tool === undefined) {
    return ''
  }
  const result = await input.run(tool, args, {
    cwd: input.root,
    timeoutMs: TOOL_TIMEOUT_MS,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(env === undefined ? {} : { env }),
  })
  return result.stdout
}

/** The Fallow and React Doctor findings in `files`. */
export async function qualityGateFindings(input: QualityGateRun): Promise<Finding[]> {
  const changed = new Set(input.files)
  const fallowFiles = input.files.some((file) => FALLOW_FILES.test(file))
  const reactFiles = input.files.filter((file) => REACT_DOCTOR_FILES.test(file))
  const fallow = fallowFiles ? binary(input.root, 'fallow') : undefined
  const reactDoctor = reactFiles.length > 0 ? binary(input.root, 'react-doctor') : undefined
  const fallowArgs = ['--format', 'json', '--quiet', '--threads', FALLOW_THREADS]
  const [deadCode, dupes, doctor] = await Promise.all([
    report(input, fallow, ['dead-code', ...fallowArgs]),
    report(input, fallow, ['dupes', ...fallowArgs]),
    report(
      input,
      reactDoctor,
      [...reactFiles, '--no-score', '--no-supply-chain', '--json', '--blocking', 'none', '-y'],
      {
        ...process.env,
        REACT_DOCTOR_PARALLEL: REACT_DOCTOR_WORKERS,
      },
    ),
  ])
  return [
    ...deadCodeFindings(deadCode, changed),
    ...duplicationFindings(dupes, changed),
    ...reactDoctorFindings(doctor, changed),
  ]
}
