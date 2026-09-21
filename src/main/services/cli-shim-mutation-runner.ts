import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getSafeChildEnv } from '../env'
import { ensureDirectoryPathPinned } from '../utils/pinned-directory-creation'
import { abortValidatedChild, waitForChildExit } from '../utils/validated-child-process'
import type { ExpectedShim, ManagedShimMutationInput } from './cli-shim-bound-mutation'

const EXECUTABLE_MODE = 0o755
const OWNER_DIRECTORY_MODE = 0o700
const MAX_MUTATION_DIAGNOSTIC_BYTES = 16 * 1024
const filesystemConstants = process.getBuiltinModule('node:fs').constants
const OPEN_DIRECTORY_NO_FOLLOW =
  filesystemConstants.O_RDONLY |
  (filesystemConstants.O_DIRECTORY ?? 0) |
  (filesystemConstants.O_NOFOLLOW ?? 0)

async function validateCommandDirectory(input: {
  readonly homeDirectory: string
  readonly directory: string
  readonly expected: { readonly dev: number; readonly ino: number }
  readonly expectedCanonicalDirectory: string
}) {
  const [canonicalHome, canonicalDirectory, current] = await Promise.all([
    fs.realpath(input.homeDirectory),
    fs.realpath(input.directory),
    fs.stat(input.directory),
  ])
  const relative = path.relative(canonicalHome, canonicalDirectory)
  const escaped =
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    canonicalDirectory !== input.expectedCanonicalDirectory
  const changed = current.dev !== input.expected.dev || current.ino !== input.expected.ino
  if (escaped || changed) throw new Error('The CLI command directory changed before mutation.')
}

function mutationArguments(
  input: {
    readonly mode: 'create' | 'replace' | 'remove'
    readonly target: string
    readonly pendingName: string
    readonly directoryIdentity: string
    readonly expectedTarget?: ExpectedShim
  },
  helperScript: string,
) {
  return [
    '-e',
    helperScript,
    input.mode,
    path.basename(input.target),
    input.pendingName,
    input.directoryIdentity,
    input.expectedTarget?.identity ?? 'missing',
    input.expectedTarget?.digest ?? 'missing',
  ]
}

function captureDiagnostic(child: ReturnType<typeof spawn>) {
  let diagnostic = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    if (diagnostic.length < MAX_MUTATION_DIAGNOSTIC_BYTES) diagnostic += chunk
  })
  return () => diagnostic.trim()
}

function waitForMutationMarker(child: ReturnType<typeof spawn>, expected: string) {
  return new Promise<void>((resolve, reject) => {
    let output = ''
    const onData = (chunk: Buffer | string) => {
      output += chunk.toString()
      if (!output.includes(`${expected}\n`)) return
      cleanup()
      resolve()
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onClose = (code: number | null) => {
      cleanup()
      reject(new Error(`CLI shim mutation helper exited before ${expected} (${code}).`))
    }
    const cleanup = () => {
      child.stdout?.off('data', onData)
      child.off('error', onError)
      child.off('close', onClose)
    }
    child.stdout?.on('data', onData)
    child.once('error', onError)
    child.once('close', onClose)
  })
}

async function releaseMutationChild(input: {
  readonly child: ReturnType<typeof spawn>
  readonly mode: 'create' | 'replace' | 'remove'
  readonly beforeManagedReplacement?: () => Promise<void>
  readonly beforeManagedCommit?: () => Promise<void>
  readonly afterManagedDisplacement?: () => Promise<void>
}) {
  await waitForMutationMarker(input.child, 'ready')
  if (input.mode === 'replace') await input.beforeManagedReplacement?.()
  if (input.mode === 'create') {
    input.child.stdin?.end('\n')
    return
  }
  const validated = waitForMutationMarker(input.child, 'validated')
  input.child.stdin?.write('\n')
  await validated
  await input.beforeManagedCommit?.()
  const displaced = waitForMutationMarker(input.child, 'displaced')
  input.child.stdin?.write('\n')
  await displaced
  await input.afterManagedDisplacement?.()
  input.child.stdin?.end('\n')
}

export async function runManagedShimMutationInternal(
  input: ManagedShimMutationInput,
  helperScript: string,
) {
  const directory = path.dirname(input.target)
  await ensureDirectoryPathPinned({ targetDirectory: directory, mode: EXECUTABLE_MODE })
  const directoryHandle = await fs.open(directory, OPEN_DIRECTORY_NO_FOLLOW)
  const directoryStats = await directoryHandle.stat()
  const expectedCanonicalDirectory = await fs.realpath(directory)
  const workingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cli-shim-'))
  await fs.chmod(workingRoot, OWNER_DIRECTORY_MODE)
  const sourcePath = path.join(workingRoot, 'shim.pending')
  const pendingName = `.openwaggle-${process.pid}-${randomUUID()}.pending`
  let sourceHandle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    if (input.expectedContent !== undefined) {
      await fs.writeFile(sourcePath, input.expectedContent, {
        encoding: 'utf8',
        flag: 'wx',
        mode: EXECUTABLE_MODE,
      })
      sourceHandle = await fs.open(sourcePath, filesystemConstants.O_RDONLY)
    }
    await input.service.beforeManagedSpawn?.({ directory, pendingName })
    const child = spawn(
      process.execPath,
      mutationArguments(
        {
          mode: input.mode,
          target: input.target,
          pendingName,
          directoryIdentity: `${directoryStats.dev}:${directoryStats.ino}`,
          ...(input.expectedTarget ? { expectedTarget: input.expectedTarget } : {}),
        },
        helperScript,
      ),
      {
        cwd: directory,
        env: { ...getSafeChildEnv(), ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe', sourceHandle?.fd ?? 'ignore'],
      },
    )
    const diagnostic = captureDiagnostic(child)
    const exitCodePromise = waitForChildExit(child)
    try {
      await validateCommandDirectory({
        homeDirectory: input.service.homeDirectory,
        directory,
        expected: directoryStats,
        expectedCanonicalDirectory,
      })
      await releaseMutationChild({
        child,
        mode: input.mode,
        ...(input.service.beforeManagedReplacement
          ? { beforeManagedReplacement: input.service.beforeManagedReplacement }
          : {}),
        ...(input.service.beforeManagedCommit
          ? { beforeManagedCommit: input.service.beforeManagedCommit }
          : {}),
        ...(input.service.afterManagedDisplacement
          ? { afterManagedDisplacement: input.service.afterManagedDisplacement }
          : {}),
      })
    } catch (error) {
      await abortValidatedChild(child, exitCodePromise)
      throw error
    }
    const exitCode = await exitCodePromise
    if (exitCode !== 0) {
      const detail = diagnostic()
      throw new Error(
        detail
          ? `The CLI path changed during mutation; OpenWaggle did not modify it: ${detail}`
          : 'The CLI path changed during mutation; OpenWaggle did not modify it.',
      )
    }
  } finally {
    await Promise.all([
      directoryHandle.close(),
      sourceHandle?.close(),
      fs.rm(workingRoot, { recursive: true, force: true }),
    ])
  }
}
