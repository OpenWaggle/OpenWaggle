/**
 * Runs one test file alone under v8 coverage and returns the units it covers.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { coveredUnits } from './units'

/** A file that takes longer is stuck; its units are left out and it is listed as failed. */
const FILE_TIMEOUT_MS = 600_000
const STDERR_TAIL = 2_000

const TIERS = [
  { pattern: /\.component\.test\.tsx$/u, config: 'vitest.component.config.ts' },
  { pattern: /\.integration\.test\.tsx?$/u, config: 'vitest.integration.config.ts' },
  { pattern: /\.unit\.test\.tsx?$/u, config: 'vitest.unit.config.ts' },
] as const

/** The Vitest config of a tier test file, or undefined for a file no tier runs. */
export function tierConfig(file: string) {
  return TIERS.find(({ pattern }) => pattern.test(file))?.config
}

export interface Measurement {
  readonly file: string
  /** Undefined when the run failed or timed out. */
  readonly units: readonly string[] | undefined
  readonly durationMs: number
  readonly error?: string
}

function run(command: string, args: readonly string[], cwd: string) {
  return new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL)
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), FILE_TIMEOUT_MS)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stderr })
    })
  })
}

export async function measureFile(root: string, file: string) {
  const started = performance.now()
  const config = tierConfig(file)
  if (config === undefined) {
    return {
      file,
      units: undefined,
      durationMs: 0,
      error: 'no tier runs this file',
    } satisfies Measurement
  }
  const reports = await mkdtemp(path.join(os.tmpdir(), 'coverage-uniqueness-'))
  try {
    const { code, stderr } = await run(
      process.execPath,
      [
        '--bun',
        'vitest',
        'run',
        '-c',
        config,
        file,
        '--maxWorkers=1',
        '--coverage.enabled',
        '--coverage.provider=v8',
        '--coverage.reporter=json',
        `--coverage.reportsDirectory=${reports}`,
        '--reporter=dot',
      ],
      root,
    )
    const durationMs = performance.now() - started
    if (code !== 0) {
      return { file, units: undefined, durationMs, error: stderr.trim() } satisfies Measurement
    }
    const coverage: unknown = JSON.parse(
      await readFile(path.join(reports, 'coverage-final.json'), 'utf8'),
    )
    return { file, units: coveredUnits(coverage, root), durationMs } satisfies Measurement
  } finally {
    await rm(reports, { recursive: true, force: true })
  }
}

/** Measures the files `concurrency` at a time, in order, calling `done` after each. */
export async function measureFiles(
  root: string,
  files: readonly string[],
  concurrency: number,
  done: (measurement: Measurement, finished: number) => void,
) {
  let next = 0
  let finished = 0
  const worker = async () => {
    while (next < files.length) {
      const file = files[next]
      next += 1
      if (file === undefined) continue
      const measurement = await measureFile(root, file)
      finished += 1
      done(measurement, finished)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
}
