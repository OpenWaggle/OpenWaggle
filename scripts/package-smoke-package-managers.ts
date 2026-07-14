import { execFile as execFileCallback } from 'node:child_process'
import os from 'node:os'
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

export async function availablePackageManagers(
  candidates: readonly PackageManager[] = PACKAGE_MANAGER_CANDIDATES,
  probe: PackageManagerProbe = probePackageManager,
  probeCwd = os.tmpdir(),
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
