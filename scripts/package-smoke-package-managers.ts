import { execFile as execFileCallback } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { PACKAGE_MANAGER_NAMES, type PackageManagerName } from './package-smoke-env'

const execFile = promisify(execFileCallback)
const EXEC_MAX_BUFFER_BYTES = 10_000_000

export interface PackageManager {
  readonly command: string
  readonly name: PackageManagerName
}

type PackageManagerProbe = (candidate: PackageManager, cwd: string) => Promise<void>

const PACKAGE_MANAGER_CANDIDATES: readonly PackageManager[] = PACKAGE_MANAGER_NAMES.map((name) => ({
  name,
  command: name,
}))

async function probePackageManager(candidate: PackageManager, cwd: string) {
  await execFile(candidate.command, ['--version'], { cwd, maxBuffer: EXEC_MAX_BUFFER_BYTES })
}

/** Probes each package manager's `--version` in `probeCwd`, a directory outside the repository. */
export async function availablePackageManagers(
  probeCwd: string,
  candidates: readonly PackageManager[] = PACKAGE_MANAGER_CANDIDATES,
  probe: PackageManagerProbe = probePackageManager,
) {
  const available: PackageManager[] = []

  for (const candidate of candidates) {
    try {
      await probe(candidate, probeCwd)
      available.push(candidate)
    } catch {
      console.log(`skipping ${candidate.name} package consumer: command is not available`)
    }
  }

  return available
}

export function assertRequiredPackageManagers(
  available: readonly PackageManager[],
  required: readonly PackageManagerName[],
) {
  const availableNames = new Set(available.map(({ name }) => name))
  const missing = required.filter((name) => !availableNames.has(name))
  if (missing.length > 0) {
    throw new Error(`Required package consumers are unavailable: ${missing.join(', ')}.`)
  }
}

/**
 * Rejects a consumer directory inside the repository. pnpm started there reads the
 * repository's `packageManager: bun` pin and refuses to run, and Yarn takes the repository
 * for its project, so every consumer project and probe lives in its own temporary directory
 * outside it (a `TMPDIR` inside the repository would otherwise put them there).
 */
export function assertOutsideRepository(directory: string, repositoryRoot: string) {
  const fromRepository = path.relative(path.resolve(repositoryRoot), path.resolve(directory))
  const outside =
    fromRepository === '..' ||
    fromRepository.startsWith(`..${path.sep}`) ||
    path.isAbsolute(fromRepository)
  if (!outside) {
    throw new Error(`Package consumers must run outside the repository, not in ${directory}.`)
  }
}

/**
 * The package managers to rehearse, probed in `consumerRoot`, which must be outside the
 * repository; fails when a required manager or every manager is missing.
 */
export async function consumerPackageManagers(
  consumerRoot: string,
  repositoryRoot: string,
  required: readonly PackageManagerName[],
) {
  assertOutsideRepository(consumerRoot, repositoryRoot)
  const available = await availablePackageManagers(consumerRoot)
  assertRequiredPackageManagers(available, required)
  if (available.length === 0) {
    throw new Error('Package consumer smoke requires npm, pnpm, Yarn, or Bun.')
  }
  return available
}
