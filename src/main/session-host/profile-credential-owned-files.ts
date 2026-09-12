import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import fs from 'node:fs/promises'
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
const OWNED_FILE_MISSING_EXIT_CODE = 44

const OWNED_FILE_HELPER = `
const fs = require('node:fs');
const crypto = require('node:crypto');
const [operation, name, expectedDirectory, prefix, suffix, expectedIdentity, displaced] = process.argv.slice(1);
const identity = (stats) => String(stats.dev) + ':' + String(stats.ino);
const fileIdentity = (descriptor, stats) => identity(stats) + ':' + crypto.createHash('sha256').update(fs.readFileSync(descriptor)).digest('hex');
const readFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
const stats = fs.statSync('.');
if (identity(stats) !== expectedDirectory) process.exit(73);
process.stdout.write('ready');
process.stdin.once('data', () => {
  try {
    let result = '';
    if (operation === 'write') {
      fs.writeFileSync(name, fs.readFileSync(3), { flag: 'wx', mode: 0o600 });
    } else if (operation === 'read') {
      const descriptor = fs.openSync(name, readFlags);
      try {
        const entry = fs.fstatSync(descriptor);
        if (!entry.isFile()) process.exit(74);
        const content = fs.readFileSync(descriptor);
        result = Buffer.from(JSON.stringify({ content: content.toString('base64'), identity: identity(entry) + ':' + crypto.createHash('sha256').update(content).digest('hex') })).toString('base64');
      } finally { fs.closeSync(descriptor); }
    } else if (operation === 'unlink') {
      fs.renameSync(name, displaced);
      const entry = fs.lstatSync(displaced);
      let actualIdentity;
      if (entry.isFile() && !entry.isSymbolicLink()) {
        let descriptor;
        try {
          descriptor = fs.openSync(displaced, readFlags);
          const descriptorEntry = fs.fstatSync(descriptor);
          if (descriptorEntry.isFile()) actualIdentity = fileIdentity(descriptor, descriptorEntry);
        } catch {}
        finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
      }
      if (!entry.isFile() || entry.isSymbolicLink() || actualIdentity !== expectedIdentity) {
        if (fs.existsSync(name)) process.exitCode = 77;
        else { fs.linkSync(displaced, name); fs.unlinkSync(displaced); process.exitCode = 74; }
        return;
      }
      fs.unlinkSync(displaced);
    } else if (operation === 'list') {
      result = Buffer.from(JSON.stringify(fs.readdirSync('.').filter((entry) => entry.startsWith(prefix) && entry.endsWith(suffix)))).toString('base64');
    }
    process.stdout.write('\\nresult=' + result);
  } catch (error) {
    if (error && error.code === 'ENOENT') process.exitCode = 44;
    else {
      process.stderr.write(error instanceof Error ? error.message : String(error));
      process.exitCode = 75;
    }
  }
});
process.stdin.resume();
`

function spawnOwnedFileHelper(
  input: {
    readonly directory: string
    readonly operation: 'read' | 'write' | 'unlink' | 'list'
    readonly name?: string
    readonly prefix?: string
    readonly suffix?: string
    readonly sourceHandle?: FileHandle
    readonly expectedIdentity?: string
    readonly displacedName?: string
  },
  directoryIdentity: string,
) {
  return spawn(
    process.execPath,
    [
      '-e',
      OWNED_FILE_HELPER,
      input.operation,
      input.name ?? 'unused',
      directoryIdentity,
      input.prefix ?? '',
      input.suffix ?? '',
      input.expectedIdentity ?? 'missing',
      input.displacedName ?? 'unused',
    ],
    {
      cwd: input.directory,
      env: { ...getSafeChildEnv(), ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe', input.sourceHandle?.fd ?? 'ignore'],
    },
  )
}

async function runOwnedFileOperation(input: {
  readonly directory: string
  readonly operation: 'read' | 'write' | 'unlink' | 'list'
  readonly name?: string
  readonly prefix?: string
  readonly suffix?: string
  readonly sourceHandle?: FileHandle
  readonly expectedIdentity?: string
  readonly displacedName?: string
  readonly beforeOperation?: () => Promise<void>
  readonly beforeSpawn?: () => Promise<void>
}) {
  const directoryHandle = await fs.open(input.directory, OPEN_DIRECTORY_NO_FOLLOW)
  try {
    const stats = await directoryHandle.stat()
    const canonicalDirectory = await fs.realpath(input.directory)
    await input.beforeSpawn?.()
    const child = spawnOwnedFileHelper(input, `${stats.dev}:${stats.ino}`)
    let output = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      output += chunk
    })
    const exitCodePromise = waitForChildExit(child)
    try {
      const [currentPath, currentStats] = await Promise.all([
        fs.realpath(input.directory),
        fs.stat(input.directory),
      ])
      if (
        currentPath !== canonicalDirectory ||
        currentStats.dev !== stats.dev ||
        currentStats.ino !== stats.ino
      ) {
        throw new Error('Protected credential storage changed during access.')
      }
      await releaseValidatedChild({
        child,
        label: 'profile credential owned-file helper',
        ...(input.beforeOperation ? { afterValidation: input.beforeOperation } : {}),
      })
    } catch (error) {
      await abortValidatedChild(child, exitCodePromise)
      throw error
    }
    const exitCode = await exitCodePromise
    if (exitCode === OWNED_FILE_MISSING_EXIT_CODE)
      return { result: undefined, directoryIdentity: `${stats.dev}:${stats.ino}` }
    if (exitCode !== 0) throw new Error('Protected credential storage changed during access.')
    return {
      result: output.match(/result=([^\n]*)$/)?.[1] ?? '',
      directoryIdentity: `${stats.dev}:${stats.ino}`,
    }
  } finally {
    await directoryHandle.close()
  }
}

export async function readOwnedFile(
  directory: string,
  name: string,
  beforeOperation?: () => Promise<void>,
  beforeSpawn?: () => Promise<void>,
) {
  const output = await runOwnedFileOperation({
    directory,
    name,
    operation: 'read',
    ...(beforeOperation ? { beforeOperation } : {}),
    ...(beforeSpawn ? { beforeSpawn } : {}),
  })
  if (output.result === undefined) {
    return {
      content: undefined,
      fileIdentity: undefined,
      directoryIdentity: output.directoryIdentity,
    }
  }
  const parsed: unknown = JSON.parse(Buffer.from(output.result, 'base64').toString('utf8'))
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('content' in parsed) ||
    typeof parsed.content !== 'string' ||
    !('identity' in parsed) ||
    typeof parsed.identity !== 'string'
  ) {
    throw new Error('Protected credential storage returned an invalid file record.')
  }
  return {
    content: Buffer.from(parsed.content, 'base64'),
    fileIdentity: parsed.identity,
    directoryIdentity: output.directoryIdentity,
  }
}

export async function writeOwnedFile(input: {
  readonly directory: string
  readonly name: string
  readonly sourceHandle: FileHandle
  readonly beforeOperation?: () => Promise<void>
  readonly beforeSpawn?: () => Promise<void>
}) {
  await runOwnedFileOperation({ ...input, operation: 'write' })
}

export async function unlinkOwnedFile(
  directory: string,
  name: string,
  expectedIdentity: string,
  beforeOperation?: () => Promise<void>,
  beforeSpawn?: () => Promise<void>,
) {
  const displacedName = `.openwaggle-owned-${randomUUID()}.displaced`
  try {
    await runOwnedFileOperation({
      directory,
      name,
      operation: 'unlink',
      expectedIdentity,
      displacedName,
      ...(beforeOperation ? { beforeOperation } : {}),
      ...(beforeSpawn ? { beforeSpawn } : {}),
    })
  } catch (error) {
    throw new Error(
      `Protected credential cleanup failed; displaced data may remain recoverable at ${directory}/${displacedName}.`,
      { cause: error },
    )
  }
}

export async function listOwnedFiles(directory: string, prefix: string, suffix: string) {
  const result = await runOwnedFileOperation({ directory, operation: 'list', prefix, suffix })
  const parsed: unknown = JSON.parse(Buffer.from(result.result ?? '', 'base64').toString('utf8'))
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error('Protected credential storage returned an invalid file listing.')
  }
  return parsed
}
