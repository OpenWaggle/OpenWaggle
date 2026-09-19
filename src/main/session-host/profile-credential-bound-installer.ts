import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs, { type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { getSafeChildEnv } from '../env'
import {
  abortValidatedChild,
  releaseValidatedChild,
  waitForChildExit,
} from '../utils/validated-child-process'

const ROLLBACK_DESTINATION_OCCUPIED_EXIT_CODE = 77
const PENDING_CLEANUP_FAILED_EXIT_CODE = 78
const ROLLBACK_OCCUPIED_AND_PENDING_CLEANUP_FAILED_EXIT_CODE = 79
const ROLLBACK_RESTORED_EXIT_CODE = 74
const INSTALLATION_FAILED_EXIT_CODE = 75
const filesystemConstants = process.getBuiltinModule('node:fs').constants
const OPEN_DIRECTORY_NO_FOLLOW =
  filesystemConstants.O_RDONLY |
  (filesystemConstants.O_DIRECTORY ?? 0) |
  (filesystemConstants.O_NOFOLLOW ?? 0)

export const CREDENTIAL_INSTALLER = `
const fs = require('node:fs');
const crypto = require('node:crypto');
const [mode, target, pending, displaced, expectedDirectory, expectedIdentity, expectedDigest] = process.argv.slice(1);
const identity = (stats) => String(stats.dev) + ':' + String(stats.ino);
const cleanupPending = () => {
  try { fs.unlinkSync(pending); return false; }
  catch (cleanupError) {
    if (cleanupError.code === 'ENOENT') return false;
    process.stderr.write(' Pending credential cleanup failed: ' + (cleanupError instanceof Error ? cleanupError.message : String(cleanupError)));
    return true;
  }
};
if (identity(fs.statSync('.')) !== expectedDirectory) process.exit(73);
process.stdout.write('ready');
process.stdin.once('data', () => {
  try {
    if (mode !== 'remove') {
      const content = fs.readFileSync(3);
      fs.writeFileSync(pending, content, { flag: 'wx', mode: 0o600 });
    }
    if (mode === 'create') {
      fs.linkSync(pending, target);
      fs.unlinkSync(pending);
      return;
    }
    fs.renameSync(target, displaced);
    const displacedStats = fs.lstatSync(displaced);
    const digest = displacedStats.isFile()
      ? crypto.createHash('sha256').update(fs.readFileSync(displaced)).digest('base64url')
      : 'not-a-file';
    if (identity(displacedStats) !== expectedIdentity || digest !== expectedDigest) {
      if (fs.existsSync(target)) process.exitCode = 77;
      else { fs.linkSync(displaced, target); fs.unlinkSync(displaced); process.exitCode = 74; }
      if (cleanupPending()) process.exitCode = process.exitCode === 77 ? 79 : 78;
      return;
    }
    if (mode === 'replace') {
      fs.linkSync(pending, target);
      fs.unlinkSync(pending);
    }
    fs.unlinkSync(displaced);
  } catch (error) {
    let displacedPresent = false;
    try {
      try { fs.lstatSync(displaced); displacedPresent = true; }
      catch (lookupError) {
        if (lookupError.code !== 'ENOENT') throw lookupError;
      }
      if (displacedPresent) {
        if (fs.existsSync(target)) process.exitCode = 77;
        else { fs.linkSync(displaced, target); fs.unlinkSync(displaced); }
      }
    } catch (rollbackError) {
      process.exitCode = 77;
      process.stderr.write(' Credential rollback failed: ' + (rollbackError instanceof Error ? rollbackError.message : String(rollbackError)));
    }
    const pendingCleanupFailed = cleanupPending();
    process.stderr.write(error instanceof Error ? error.message : String(error));
    if (pendingCleanupFailed) process.exitCode = process.exitCode === 77 ? 79 : 78;
    else if (process.exitCode !== 77) process.exitCode = 75;
  }
});
process.stdin.resume();
`

export class ProfileCredentialInstallerRecoveryError extends Error {
  constructor(
    readonly recoveryLocations: readonly string[],
    options?: ErrorOptions,
  ) {
    super(
      `Credential installation did not finish. Protected installer artifacts may remain at ${recoveryLocations.join(' and ')}.`,
      options,
    )
    this.name = 'ProfileCredentialInstallerRecoveryError'
  }
}

export function profileCredentialInstallerFailure(input: {
  readonly exitCode: number | null
  readonly directory: string
  readonly pendingName: string
  readonly displacedName: string
}): Error | null {
  if (input.exitCode === 0) return null
  const pendingPath = path.join(input.directory, input.pendingName)
  const displacedPath = path.join(input.directory, input.displacedName)
  if (input.exitCode === ROLLBACK_DESTINATION_OCCUPIED_EXIT_CODE) {
    return new ProfileCredentialInstallerRecoveryError([displacedPath])
  }
  if (input.exitCode === PENDING_CLEANUP_FAILED_EXIT_CODE) {
    return new ProfileCredentialInstallerRecoveryError([pendingPath])
  }
  if (input.exitCode === ROLLBACK_OCCUPIED_AND_PENDING_CLEANUP_FAILED_EXIT_CODE) {
    return new ProfileCredentialInstallerRecoveryError([pendingPath, displacedPath])
  }
  if (
    input.exitCode !== ROLLBACK_RESTORED_EXIT_CODE &&
    input.exitCode !== INSTALLATION_FAILED_EXIT_CODE
  ) {
    // A signal or unexpected exit after the validated child was released can leave
    // either artifact behind; neither outcome is safe to infer from its exit code.
    return new ProfileCredentialInstallerRecoveryError([pendingPath, displacedPath])
  }
  return new Error('The credential destination changed after it was prepared.')
}

export async function installCredentialInBoundDirectory(input: {
  readonly directory: string
  readonly directoryIdentity: string
  readonly targetName: string
  readonly mode: 'create' | 'replace'
  readonly expectedIdentity?: string
  readonly expectedDigest?: string
  readonly sourceHandle: FileHandle
  readonly beforeMutation?: () => Promise<void>
  readonly beforeSpawn?: () => Promise<void>
}) {
  const pendingName = `.openwaggle-credential-${randomUUID()}.pending`
  const displacedName = `.openwaggle-credential-${randomUUID()}.displaced`
  const directoryHandle = await fs.open(input.directory, OPEN_DIRECTORY_NO_FOLLOW)
  try {
    const directoryStats = await directoryHandle.stat()
    const canonicalDirectory = await fs.realpath(input.directory)
    if (`${directoryStats.dev}:${directoryStats.ino}` !== input.directoryIdentity) {
      throw new Error('The credential destination changed after it was prepared.')
    }
    await input.beforeSpawn?.()
    const child = spawn(
      process.execPath,
      [
        '-e',
        CREDENTIAL_INSTALLER,
        input.mode,
        input.targetName,
        pendingName,
        displacedName,
        input.directoryIdentity,
        input.expectedIdentity ?? 'missing',
        input.expectedDigest ?? 'missing',
      ],
      {
        cwd: input.directory,
        env: { ...getSafeChildEnv(), ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe', input.sourceHandle.fd],
      },
    )
    const exitCodePromise = waitForChildExit(child)
    try {
      const [currentPath, currentStats] = await Promise.all([
        fs.realpath(input.directory),
        fs.stat(input.directory),
      ])
      if (
        currentPath !== canonicalDirectory ||
        currentStats.dev !== directoryStats.dev ||
        currentStats.ino !== directoryStats.ino
      ) {
        throw new Error('The credential destination changed after it was prepared.')
      }
      await releaseValidatedChild({
        child,
        label: 'profile credential installation helper',
        ...(input.beforeMutation ? { afterValidation: input.beforeMutation } : {}),
      })
    } catch (error) {
      await abortValidatedChild(child, exitCodePromise)
      throw error
    }
    let exitCode: number | null
    try {
      exitCode = await exitCodePromise
    } catch (cause) {
      throw new ProfileCredentialInstallerRecoveryError(
        [path.join(input.directory, pendingName), path.join(input.directory, displacedName)],
        { cause },
      )
    }
    const failure = profileCredentialInstallerFailure({
      exitCode,
      directory: input.directory,
      pendingName,
      displacedName,
    })
    if (failure) throw failure
  } finally {
    await directoryHandle.close()
  }
}
