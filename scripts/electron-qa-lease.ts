import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isMatching, P } from '@diegogbrisa/ts-match'
import lockfile from 'proper-lockfile'

export const QA_CDP_PORT = 9223
const QA_PROFILE_PREFIX = 'openwaggle-qa-profile-'
const QA_ARTIFACT_PREFIX = 'openwaggle-qa-evidence-'
const QA_LEASE_CANDIDATE_PREFIX = 'openwaggle-qa-lease-candidate-'
const QA_LEASE_DIRECTORY = path.join(os.tmpdir(), `openwaggle-qa-${QA_CDP_PORT}.lease`)
const QA_LEASE_METADATA = 'metadata.json'
const QA_LEASE_VERSION = 1
const CLEANUP_RETRY_COUNT = 10
const CLEANUP_RETRY_DELAY_MS = 100
const LEASE_LOCK_STALE_MS = 60_000
const LEASE_LOCK_UPDATE_MS = 15_000
const LEASE_LOCK_RETRIES = 20
const LEASE_LOCK_RETRY_MIN_MS = 20
const LEASE_LOCK_RETRY_MAX_MS = 250
const JSON_INDENT_SPACES = 2
const QA_PROFILE_REMOVE_OPTIONS = {
  force: true,
  maxRetries: CLEANUP_RETRY_COUNT,
  recursive: true,
  retryDelay: CLEANUP_RETRY_DELAY_MS,
} as const

const leaseMetadataPattern = {
  version: P.literal(QA_LEASE_VERSION),
  launcherPid: P.integer,
  port: P.literal(QA_CDP_PORT),
  profilePath: P.string,
  artifactsPath: P.string,
  projectPath: P.string,
}

export interface QaLeaseMetadata {
  readonly version: typeof QA_LEASE_VERSION
  readonly launcherPid: number
  readonly port: typeof QA_CDP_PORT
  readonly profilePath: string
  readonly artifactsPath: string
  readonly projectPath: string
}

export interface QaLease {
  readonly metadata: QaLeaseMetadata
  readonly directory: string
  readonly automationIdentity: string
}

function errorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

export function parseQaLeaseMetadata(value: unknown): QaLeaseMetadata | null {
  if (!isMatching(leaseMetadataPattern, value)) return null
  if (value.launcherPid <= 0) return null
  return value
}

export function isOwnedQaTemporaryPath(candidate: string, prefix: string) {
  const resolvedCandidate = path.resolve(candidate)
  return (
    path.dirname(resolvedCandidate) === path.resolve(os.tmpdir()) &&
    path.basename(resolvedCandidate).startsWith(prefix)
  )
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCode(error) !== 'ESRCH'
  }
}

async function readLeaseMetadata(directory: string) {
  const raw: unknown = JSON.parse(
    await fs.readFile(path.join(directory, QA_LEASE_METADATA), 'utf8'),
  )
  return parseQaLeaseMetadata(raw)
}

async function withLeaseMutationLock<T>(leaseDirectory: string, operation: () => Promise<T>) {
  const release = await lockfile.lock(leaseDirectory, {
    realpath: false,
    stale: LEASE_LOCK_STALE_MS,
    update: LEASE_LOCK_UPDATE_MS,
    retries: {
      retries: LEASE_LOCK_RETRIES,
      minTimeout: LEASE_LOCK_RETRY_MIN_MS,
      maxTimeout: LEASE_LOCK_RETRY_MAX_MS,
      randomize: true,
    },
  })
  try {
    return await operation()
  } finally {
    await release()
  }
}

async function recoverStaleLeaseUnderLock(leaseDirectory: string) {
  const leaseStats = await fs.lstat(leaseDirectory).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  })
  if (leaseStats === null) return
  if (!leaseStats.isDirectory() || leaseStats.isSymbolicLink()) {
    throw new Error(`QA lease path is not a real directory: ${leaseDirectory}`)
  }

  const metadata = await readLeaseMetadata(leaseDirectory)
  if (metadata === null) {
    throw new Error(
      `QA lease metadata is invalid. Inspect the lease before removing it: ${leaseDirectory}`,
    )
  }
  if (isProcessAlive(metadata.launcherPid)) {
    throw new Error(
      `Hidden Electron QA is already owned by launcher PID ${metadata.launcherPid} on port ${QA_CDP_PORT}.`,
    )
  }
  if (!isOwnedQaTemporaryPath(metadata.profilePath, QA_PROFILE_PREFIX)) {
    throw new Error(`Refusing to remove an untrusted stale QA profile: ${metadata.profilePath}`)
  }

  const quarantineDirectory = `${leaseDirectory}.stale-${randomUUID()}`
  await fs.rename(leaseDirectory, quarantineDirectory)
  const quarantinedMetadata = await readLeaseMetadata(quarantineDirectory)
  if (quarantinedMetadata?.launcherPid !== metadata.launcherPid) {
    throw new Error(`Stale QA lease changed while it was being quarantined: ${leaseDirectory}`)
  }
  await fs.rm(metadata.profilePath, QA_PROFILE_REMOVE_OPTIONS)
  await fs.rm(quarantineDirectory, { force: true, recursive: true })
  console.info(`[electron-qa] recovered stale lease from launcher PID ${metadata.launcherPid}`)
}

export function recoverStaleQaLease(leaseDirectory = QA_LEASE_DIRECTORY) {
  return withLeaseMutationLock(leaseDirectory, () => recoverStaleLeaseUnderLock(leaseDirectory))
}

export function acquireQaLease(projectPath: string): Promise<QaLease> {
  return withLeaseMutationLock(QA_LEASE_DIRECTORY, async () => {
    await recoverStaleLeaseUnderLock(QA_LEASE_DIRECTORY)
    const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), QA_PROFILE_PREFIX))
    const artifactsPath = await fs.mkdtemp(path.join(os.tmpdir(), QA_ARTIFACT_PREFIX))
    const candidateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), QA_LEASE_CANDIDATE_PREFIX))
    const metadata = {
      version: QA_LEASE_VERSION,
      launcherPid: process.pid,
      port: QA_CDP_PORT,
      profilePath,
      artifactsPath,
      projectPath,
    } satisfies QaLeaseMetadata

    try {
      await fs.writeFile(
        path.join(candidateDirectory, QA_LEASE_METADATA),
        `${JSON.stringify(metadata, null, JSON_INDENT_SPACES)}\n`,
        'utf8',
      )
      await fs.rename(candidateDirectory, QA_LEASE_DIRECTORY)
      return {
        metadata,
        directory: QA_LEASE_DIRECTORY,
        automationIdentity: randomUUID(),
      }
    } catch (error) {
      await Promise.all([
        fs.rm(candidateDirectory, { force: true, recursive: true }),
        fs.rm(profilePath, QA_PROFILE_REMOVE_OPTIONS),
        fs.rm(artifactsPath, { force: true, recursive: true }),
      ])
      throw error
    }
  })
}

export function releaseQaLease(lease: QaLease) {
  return withLeaseMutationLock(lease.directory, async () => {
    if (!isOwnedQaTemporaryPath(lease.metadata.profilePath, QA_PROFILE_PREFIX)) {
      throw new Error(`Refusing to remove an untrusted QA profile: ${lease.metadata.profilePath}`)
    }
    const currentMetadata = await readLeaseMetadata(lease.directory).catch(() => null)
    if (currentMetadata?.launcherPid !== process.pid) {
      throw new Error(`Refusing to remove a QA lease no longer owned by PID ${process.pid}.`)
    }
    await fs.rm(lease.metadata.profilePath, QA_PROFILE_REMOVE_OPTIONS)
    await fs.rm(lease.directory, { force: true, recursive: true })
  })
}
