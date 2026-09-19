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

const filesystemConstants = process.getBuiltinModule('node:fs').constants
const OPEN_DIRECTORY_NO_FOLLOW =
  filesystemConstants.O_RDONLY |
  (filesystemConstants.O_DIRECTORY ?? 0) |
  (filesystemConstants.O_NOFOLLOW ?? 0)
const MAX_MUTATION_DIAGNOSTIC_BYTES = 64 * 1024

const BOUND_DEFINITION_MUTATION = `
const crypto = require('node:crypto');
const fs = require('node:fs');
const [mode, destination, pending, displaced, expectedDirectory, expectedIdentity, expectedDigest, sourceDigest, faultInjection] = process.argv.slice(1);
const identity = (stats) => String(stats.dev) + ':' + String(stats.ino);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
if (identity(fs.statSync('.')) !== expectedDirectory) process.exit(73);
let ownsPending = false;
let ownsDisplaced = false;
let installedIdentity;
const installExclusive = (source, target) => {
  try { fs.linkSync(source, target); }
  catch (error) {
    if (!error || !['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error.code)) throw error;
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  }
};
const removeOwned = (name, owned) => {
  if (!owned) return;
  try { fs.unlinkSync(name); } catch (error) { if (!error || error.code !== 'ENOENT') throw error; }
};
const restoreDisplaced = () => {
  if (!ownsDisplaced) return;
  const visible = fs.lstatSync(displaced);
  if (visible.isSymbolicLink() || !visible.isFile()) throw new Error('Cannot safely restore displaced Agent definition.');
  installExclusive(displaced, destination);
  fs.unlinkSync(displaced);
  ownsDisplaced = false;
};
const recordInstalled = () => { installedIdentity = identity(fs.statSync(destination)); };
const rollbackInstalled = () => {
  if (!installedIdentity) return;
  const visible = fs.lstatSync(destination);
  const current = fs.statSync(destination);
  if (visible.isSymbolicLink() || !visible.isFile() || identity(current) !== installedIdentity || digest(fs.readFileSync(destination)) !== sourceDigest) {
    throw new Error('Cannot safely roll back installed Agent definition.');
  }
  fs.unlinkSync(destination);
  installedIdentity = undefined;
};
const destinationAbsent = () => {
  try { fs.lstatSync(destination); return false; }
  catch (error) { if (!error || error.code !== 'ENOENT') throw error; return true; }
};
process.stdout.write('ready');
process.stdin.once('data', () => {
  try {
    if (mode !== 'delete') {
      const source = fs.readFileSync(3);
      if (digest(source) !== sourceDigest) { process.exitCode = 76; return; }
      const pendingHandle = fs.openSync(pending, 'wx', 0o600);
      ownsPending = true;
      try {
        if (faultInjection === 'after-pending-open') throw new Error('Injected pending-write failure.');
        fs.writeFileSync(pendingHandle, source);
      } finally { fs.closeSync(pendingHandle); }
    }
    if (mode === 'create') {
      try { fs.lstatSync(destination); process.exitCode = 74; return; }
      catch (error) { if (!error || error.code !== 'ENOENT') throw error; }
      installExclusive(pending, destination);
      recordInstalled();
      if (faultInjection === 'after-install') throw new Error('Injected post-install failure.');
      fs.unlinkSync(pending);
      ownsPending = false;
      installedIdentity = undefined;
      return;
    }
    fs.renameSync(destination, displaced);
    ownsDisplaced = true;
    let valid = false;
    try {
      const visible = fs.lstatSync(displaced);
      const handle = fs.openSync(displaced, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try {
        const stats = fs.fstatSync(handle);
        const current = fs.statSync(displaced);
        valid = !visible.isSymbolicLink() && stats.isFile() && identity(visible) === expectedIdentity && identity(stats) === expectedIdentity && identity(current) === expectedIdentity && digest(fs.readFileSync(handle)) === expectedDigest;
      } finally { fs.closeSync(handle); }
    } catch {}
    if (!valid) {
      try { restoreDisplaced(); process.exitCode = 75; }
      catch (error) { process.stderr.write(error instanceof Error ? error.message : String(error)); process.exitCode = 77; }
      return;
    }
    if (faultInjection === 'after-displacement') throw new Error('Injected post-displacement failure.');
    if (faultInjection === 'occupy-destination') fs.writeFileSync(destination, 'Concurrent definition.');
    if (!destinationAbsent()) throw new Error('Agent definition destination was concurrently recreated; original is retained in ' + displaced + '.');
    if (mode === 'replace') {
      installExclusive(pending, destination);
      recordInstalled();
      fs.unlinkSync(pending);
      ownsPending = false;
      if (faultInjection === 'after-install') throw new Error('Injected post-install failure.');
    }
    fs.unlinkSync(displaced);
    ownsDisplaced = false;
    installedIdentity = undefined;
  } catch (error) {
    const primary = error instanceof Error ? error.message : String(error);
    let restoration = ownsDisplaced ? '; original retained in ' + displaced : '';
    try { rollbackInstalled(); restoreDisplaced(); restoration = ''; }
    catch (restoreError) { restoration += '; restoration failed: ' + (restoreError instanceof Error ? restoreError.message : String(restoreError)); }
    process.stderr.write(primary + restoration);
    process.exitCode = 77;
  } finally {
    removeOwned(pending, ownsPending);
  }
});
process.stdin.resume();
`

async function validateDefinitionDirectory(input: {
  readonly rootPath: string
  readonly directory: string
  readonly rootStats: { readonly dev: number; readonly ino: number }
  readonly directoryStats: { readonly dev: number; readonly ino: number }
  readonly expectedDirectoryIdentity: string
  readonly expectedCanonicalDirectory: string
}) {
  const [canonicalRoot, canonicalDirectory, currentRoot, currentDirectory] = await Promise.all([
    fs.realpath(input.rootPath),
    fs.realpath(input.directory),
    fs.stat(input.rootPath),
    fs.stat(input.directory),
  ])
  const relativeDirectory = path.relative(canonicalRoot, canonicalDirectory)
  const escaped = relativeDirectory.startsWith('..') || path.isAbsolute(relativeDirectory)
  if (escaped || canonicalDirectory !== input.expectedCanonicalDirectory) {
    throw new Error('Agent definition mutation escaped its trusted root.')
  }
  const changed =
    `${input.directoryStats.dev}:${input.directoryStats.ino}` !== input.expectedDirectoryIdentity ||
    input.directoryStats.dev !== currentDirectory.dev ||
    input.directoryStats.ino !== currentDirectory.ino ||
    input.rootStats.dev !== currentRoot.dev ||
    input.rootStats.ino !== currentRoot.ino
  if (changed) throw new Error('Agent definition directory changed after authorization.')
}

async function bindMutationDirectories(input: {
  readonly rootPath: string
  readonly directory: string
  readonly platform: NodeJS.Platform
}) {
  const rootHandle =
    input.platform === 'win32' ? undefined : await fs.open(input.rootPath, OPEN_DIRECTORY_NO_FOLLOW)
  let directoryHandle: FileHandle | undefined
  try {
    directoryHandle =
      input.platform === 'win32'
        ? undefined
        : await fs.open(input.directory, OPEN_DIRECTORY_NO_FOLLOW)
    const [directoryEntry, rootEntry] = await Promise.all([
      fs.lstat(input.directory),
      fs.lstat(input.rootPath),
    ])
    if (
      directoryEntry.isSymbolicLink() ||
      !directoryEntry.isDirectory() ||
      rootEntry.isSymbolicLink() ||
      !rootEntry.isDirectory()
    ) {
      throw new Error('Agent definition mutation requires trusted directories.')
    }
    return {
      rootHandle,
      directoryHandle,
      directoryStats: directoryHandle ? await directoryHandle.stat() : directoryEntry,
      rootStats: rootHandle ? await rootHandle.stat() : rootEntry,
      expectedCanonicalDirectory: await fs.realpath(input.directory),
    }
  } catch (error) {
    await Promise.all([rootHandle?.close(), directoryHandle?.close()])
    throw error
  }
}

function spawnMutationChild(
  input: Parameters<typeof mutateDefinitionInBoundDirectory>[0],
  directoryIdentity: string,
) {
  const displaced = `.${path.basename(input.destinationPath)}.${randomUUID()}.displaced`
  return spawn(
    process.execPath,
    [
      '-e',
      BOUND_DEFINITION_MUTATION,
      input.mode,
      path.basename(input.destinationPath),
      input.pendingName,
      displaced,
      directoryIdentity,
      input.expectedIdentity ?? 'missing',
      input.expectedContentDigest ?? 'missing',
      input.sourceDigest ?? 'none',
      input.faultInjection ?? 'none',
    ],
    {
      env: { ...getSafeChildEnv(), ELECTRON_RUN_AS_NODE: '1' },
      cwd: input.directory,
      stdio: ['pipe', 'pipe', 'pipe', input.sourceHandle?.fd ?? 'ignore'],
    },
  )
}

export async function mutateDefinitionInBoundDirectory(input: {
  readonly rootPath: string
  readonly directory: string
  readonly destinationPath: string
  readonly pendingName: string
  readonly mode: 'create' | 'replace' | 'delete'
  readonly expectedIdentity?: string
  readonly expectedContentDigest?: string
  readonly expectedDirectoryIdentity: string
  readonly sourceHandle?: FileHandle
  readonly sourceDigest?: string
  readonly beforeMutation?: () => Promise<void>
  readonly beforeSpawn?: () => Promise<void>
  readonly platform?: NodeJS.Platform
  readonly faultInjection?:
    | 'after-pending-open'
    | 'after-displacement'
    | 'after-install'
    | 'occupy-destination'
}) {
  const platform = input.platform ?? process.platform
  const binding = await bindMutationDirectories({
    rootPath: input.rootPath,
    directory: input.directory,
    platform,
  })
  try {
    await input.beforeSpawn?.()
    const child = spawnMutationChild(
      input,
      `${binding.directoryStats.dev}:${binding.directoryStats.ino}`,
    )
    let diagnostic = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      if (diagnostic.length < MAX_MUTATION_DIAGNOSTIC_BYTES) diagnostic += chunk
    })
    const exitCodePromise = waitForChildExit(child)
    try {
      await validateDefinitionDirectory({
        rootPath: input.rootPath,
        directory: input.directory,
        rootStats: binding.rootStats,
        directoryStats: binding.directoryStats,
        expectedDirectoryIdentity: input.expectedDirectoryIdentity,
        expectedCanonicalDirectory: binding.expectedCanonicalDirectory,
      })
      await releaseValidatedChild({
        child,
        label: 'Agent definition mutation helper',
        ...(input.beforeMutation ? { afterValidation: input.beforeMutation } : {}),
      })
    } catch (error) {
      await abortValidatedChild(child, exitCodePromise)
      throw error
    }
    const exitCode = await exitCodePromise
    if (exitCode !== 0) {
      throw new Error(
        `Descriptor-bound Agent definition mutation failed (${exitCode}): ${diagnostic.trim()}`,
      )
    }
  } finally {
    await Promise.all([binding.rootHandle?.close(), binding.directoryHandle?.close()])
  }
}
