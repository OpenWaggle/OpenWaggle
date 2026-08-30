import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getSafeChildEnv } from '../env'
import { releaseValidatedChild, waitForChildExit } from './validated-child-process'

const filesystemConstants = process.getBuiltinModule('node:fs').constants
const OPEN_DIRECTORY_NO_FOLLOW =
  filesystemConstants.O_RDONLY |
  (filesystemConstants.O_DIRECTORY ?? 0) |
  (filesystemConstants.O_NOFOLLOW ?? 0)

const PINNED_DIRECTORY_CREATOR = String.raw`
const fs = require('node:fs');
const [expectedDirectory, modeText, component] = process.argv.slice(1);
const stats = fs.statSync('.');
if (String(stats.dev) + ':' + String(stats.ino) !== expectedDirectory) process.exit(73);
process.stdout.write('ready');
process.stdin.once('data', () => {
  try {
    const mode = Number(modeText);
    if (component === '.' || component === '..' || component.includes('/') || component.includes('\\')) {
      process.exitCode = 74;
      return;
    }
    let entry;
    try {
      entry = fs.lstatSync(component);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        process.exitCode = 75;
        return;
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
      fs.mkdirSync(component, { mode });
      entry = fs.lstatSync(component);
    }
    process.stdout.write('\nresult=' + String(entry.dev) + ':' + String(entry.ino));
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exitCode = 76;
  }
});
process.stdin.resume();
`

async function nearestExistingDirectory(targetDirectory: string) {
  let candidate = path.resolve(targetDirectory)
  const components: string[] = []
  while (true) {
    try {
      const handle = await fs.open(candidate, OPEN_DIRECTORY_NO_FOLLOW)
      return { directory: candidate, handle, components: components.reverse() }
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      const parent = path.dirname(candidate)
      if (parent === candidate) throw error
      components.push(path.basename(candidate))
      candidate = parent
    }
  }
}

export async function ensureDirectoryPathPinned(input: {
  readonly targetDirectory: string
  readonly mode: number
  readonly beforeMutation?: () => Promise<void>
  readonly beforeComponentMutation?: (component: string, index: number) => Promise<void>
}) {
  const existing = await nearestExistingDirectory(input.targetDirectory)
  let currentDirectory = existing.directory
  let currentHandle = existing.handle
  const beforeComponentMutation = input.beforeComponentMutation
  try {
    if (existing.components.length === 0) return
    for (const [index, component] of existing.components.entries()) {
      const stats = await currentHandle.stat()
      const child = spawn(
        process.execPath,
        [
          '-e',
          PINNED_DIRECTORY_CREATOR,
          `${stats.dev}:${stats.ino}`,
          String(input.mode),
          component,
        ],
        {
          cwd: currentDirectory,
          env: { ...getSafeChildEnv(), ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )
      let output = ''
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        output += chunk
      })
      const exitCodePromise = waitForChildExit(child)
      await releaseValidatedChild({
        child,
        label: 'directory creation helper',
        ...(beforeComponentMutation
          ? { afterValidation: () => beforeComponentMutation(component, index) }
          : index === 0 && input.beforeMutation
            ? { afterValidation: input.beforeMutation }
            : {}),
      })
      const exitCode = await exitCodePromise
      if (exitCode !== 0) throw new Error('Directory creation escaped its pinned parent.')
      const expectedIdentity = output.match(/result=(\d+:\d+)$/)?.[1]
      if (!expectedIdentity) throw new Error('Directory creation helper returned no identity.')
      const nextDirectory = path.join(currentDirectory, component)
      const nextHandle = await fs.open(nextDirectory, OPEN_DIRECTORY_NO_FOLLOW)
      const nextStats = await nextHandle.stat()
      if (`${nextStats.dev}:${nextStats.ino}` !== expectedIdentity) {
        await nextHandle.close()
        throw new Error('Directory component changed after its pinned creation.')
      }
      await currentHandle.close()
      currentDirectory = nextDirectory
      currentHandle = nextHandle
    }
  } finally {
    await currentHandle.close().catch(() => undefined)
  }
}
