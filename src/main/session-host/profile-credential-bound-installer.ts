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
const filesystemConstants = process.getBuiltinModule('node:fs').constants
const OPEN_DIRECTORY_NO_FOLLOW =
  filesystemConstants.O_RDONLY |
  (filesystemConstants.O_DIRECTORY ?? 0) |
  (filesystemConstants.O_NOFOLLOW ?? 0)

const CREDENTIAL_INSTALLER = `
const fs = require('node:fs');
const crypto = require('node:crypto');
const [mode, target, pending, displaced, expectedDirectory, expectedIdentity, expectedDigest] = process.argv.slice(1);
const identity = (stats) => String(stats.dev) + ':' + String(stats.ino);
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
      return;
    }
    if (mode === 'replace') {
      fs.linkSync(pending, target);
      fs.unlinkSync(pending);
    }
    fs.unlinkSync(displaced);
  } catch (error) {
    try {
      if (fs.existsSync(displaced)) {
        if (fs.existsSync(target)) process.exitCode = 77;
        else { fs.linkSync(displaced, target); fs.unlinkSync(displaced); }
      }
    } catch (rollbackError) {
      process.stderr.write(' Credential rollback failed: ' + (rollbackError instanceof Error ? rollbackError.message : String(rollbackError)));
    }
    try { if (fs.existsSync(pending)) fs.unlinkSync(pending); } catch {}
    process.stderr.write(error instanceof Error ? error.message : String(error));
    if (process.exitCode !== 77) process.exitCode = 75;
  }
});
process.stdin.resume();
`

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
    const exitCode = await exitCodePromise
    if (exitCode === ROLLBACK_DESTINATION_OCCUPIED_EXIT_CODE) {
      throw new Error(
        `The credential destination was occupied during rollback; the original remains recoverable at ${path.join(input.directory, displacedName)}.`,
      )
    }
    if (exitCode !== 0) {
      throw new Error('The credential destination changed after it was prepared.')
    }
  } finally {
    await directoryHandle.close()
  }
}
