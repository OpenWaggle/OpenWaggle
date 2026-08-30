import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getSafeChildEnv } from '../env'
import { ensureDirectoryPathPinned } from '../utils/pinned-directory-creation'
import {
  abortValidatedChild,
  releaseValidatedChild,
  waitForChildExit,
} from '../utils/validated-child-process'

const EXECUTABLE_MODE = 0o755
const OWNER_DIRECTORY_MODE = 0o700
const ROLLBACK_DESTINATION_OCCUPIED_EXIT_CODE = 77
const filesystemConstants = process.getBuiltinModule('node:fs').constants
const OPEN_DIRECTORY_NO_FOLLOW =
  filesystemConstants.O_RDONLY |
  (filesystemConstants.O_DIRECTORY ?? 0) |
  (filesystemConstants.O_NOFOLLOW ?? 0)

const DARWIN_CLI_MUTATION = `
set -eu
[ "$(/usr/bin/stat -f '%d:%i' .)" = "$5" ] || exit 73
/usr/bin/printf ready
IFS= read -r _
if [ "$1" = "create" ]; then trap '/bin/rm -f -- "$3"' EXIT; /bin/cat <&3 > "$3"; /bin/chmod 755 "$3"; /bin/ln -h -- "$3" "$2"; /bin/rm -- "$3"; trap - EXIT; exit 0; fi
rollback() { code=$?; trap - EXIT; /bin/rm -f -- "$3"; if [ -e "$4" ] || [ -L "$4" ]; then if [ -e "$2" ] || [ -L "$2" ]; then exit 77; else /bin/ln -h -- "$4" "$2"; /bin/rm -- "$4"; fi; fi; exit "$code"; }
trap rollback EXIT
if [ "$1" != "remove" ]; then /bin/cat <&3 > "$3"; /bin/chmod 755 "$3"; fi
/bin/mv -- "$2" "$4"
actual_identity=$(/usr/bin/stat -f '%d:%i' "$4")
actual_digest=$(/usr/bin/shasum -a 256 "$4" | /usr/bin/awk '{print $1}')
if [ "$actual_identity" != "$6" ] || [ "$actual_digest" != "$7" ]; then if [ -e "$2" ] || [ -L "$2" ]; then exit 77; else /bin/ln -h -- "$4" "$2"; /bin/rm -- "$4"; trap - EXIT; exit 74; fi; fi
if [ "$1" = "replace" ]; then /bin/ln -h -- "$3" "$2"; /bin/rm -- "$3"; fi
/bin/rm -- "$4"
trap - EXIT
`

const LINUX_CLI_MUTATION = `
set -eu
[ "$(/usr/bin/stat -c '%d:%i' .)" = "$5" ] || exit 73
/usr/bin/printf ready
IFS= read -r _
if [ "$1" = "create" ]; then trap '/bin/rm -f -- "$3"' EXIT; /bin/cat <&3 > "$3"; /bin/chmod 755 "$3"; /bin/ln -T -- "$3" "$2"; /bin/rm -- "$3"; trap - EXIT; exit 0; fi
rollback() { code=$?; trap - EXIT; /bin/rm -f -- "$3"; if [ -e "$4" ] || [ -L "$4" ]; then if [ -e "$2" ] || [ -L "$2" ]; then exit 77; else /bin/ln -T -- "$4" "$2"; /bin/rm -- "$4"; fi; fi; exit "$code"; }
trap rollback EXIT
if [ "$1" != "remove" ]; then /bin/cat <&3 > "$3"; /bin/chmod 755 "$3"; fi
/bin/mv -- "$2" "$4"
actual_identity=$(/usr/bin/stat -c '%d:%i' "$4")
actual_digest=$(/usr/bin/sha256sum "$4" | /usr/bin/awk '{print $1}')
if [ "$actual_identity" != "$6" ] || [ "$actual_digest" != "$7" ]; then if [ -e "$2" ] || [ -L "$2" ]; then exit 77; else /bin/ln -T -- "$4" "$2"; /bin/rm -- "$4"; trap - EXIT; exit 74; fi; fi
if [ "$1" = "replace" ]; then /bin/ln -T -- "$3" "$2"; /bin/rm -- "$3"; fi
/bin/rm -- "$4"
trap - EXIT
`

export interface CliShimMutationServiceInput {
  readonly platform: NodeJS.Platform
  readonly homeDirectory: string
  readonly beforeManagedReplacement?: () => Promise<void>
  readonly beforeManagedSpawn?: () => Promise<void>
}

interface ExpectedShim {
  readonly identity: string
  readonly digest: string
}

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

function mutationArguments(input: {
  readonly platform: NodeJS.Platform
  readonly mode: 'create' | 'replace' | 'remove'
  readonly target: string
  readonly pendingName: string
  readonly displacedName: string
  readonly directoryIdentity: string
  readonly expectedTarget?: ExpectedShim
}) {
  return [
    '-c',
    input.platform === 'darwin' ? DARWIN_CLI_MUTATION : LINUX_CLI_MUTATION,
    'openwaggle-cli-shim',
    input.mode,
    path.basename(input.target),
    input.pendingName,
    input.displacedName,
    input.directoryIdentity,
    input.expectedTarget?.identity ?? 'missing',
    input.expectedTarget?.digest ?? 'missing',
  ]
}

export async function runManagedShimMutation(input: {
  readonly service: CliShimMutationServiceInput
  readonly target: string
  readonly expectedContent?: string
  readonly mode: 'create' | 'replace' | 'remove'
  readonly expectedTarget?: ExpectedShim
}) {
  const directory = path.dirname(input.target)
  await ensureDirectoryPathPinned({ targetDirectory: directory, mode: EXECUTABLE_MODE })
  const directoryHandle = await fs.open(directory, OPEN_DIRECTORY_NO_FOLLOW)
  const directoryStats = await directoryHandle.stat()
  const expectedCanonicalDirectory = await fs.realpath(directory)
  const workingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cli-shim-'))
  await fs.chmod(workingRoot, OWNER_DIRECTORY_MODE)
  const sourcePath = path.join(workingRoot, 'shim.pending')
  const pendingName = `.openwaggle-${process.pid}-${randomUUID()}.pending`
  const displacedName = `.openwaggle-${process.pid}-${randomUUID()}.displaced`
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
    await input.service.beforeManagedSpawn?.()
    const child = spawn(
      '/bin/sh',
      mutationArguments({
        platform: input.service.platform,
        mode: input.mode,
        target: input.target,
        pendingName,
        displacedName,
        directoryIdentity: `${directoryStats.dev}:${directoryStats.ino}`,
        ...(input.expectedTarget ? { expectedTarget: input.expectedTarget } : {}),
      }),
      {
        cwd: directory,
        env: getSafeChildEnv(),
        stdio: ['pipe', 'pipe', 'ignore', sourceHandle?.fd ?? 'ignore'],
      },
    )
    const exitCodePromise = waitForChildExit(child)
    try {
      await validateCommandDirectory({
        homeDirectory: input.service.homeDirectory,
        directory,
        expected: directoryStats,
        expectedCanonicalDirectory,
      })
      await releaseValidatedChild({
        child,
        label: 'CLI shim mutation helper',
        ...(input.mode === 'replace' && input.service.beforeManagedReplacement
          ? { afterValidation: input.service.beforeManagedReplacement }
          : {}),
      })
    } catch (error) {
      await abortValidatedChild(child, exitCodePromise)
      throw error
    }
    const exitCode = await exitCodePromise
    if (exitCode === ROLLBACK_DESTINATION_OCCUPIED_EXIT_CODE) {
      throw new Error(
        `The CLI destination was occupied during rollback; the managed shim remains recoverable at ${path.join(directory, displacedName)}.`,
      )
    }
    if (exitCode !== 0) {
      throw new Error('The CLI path changed during mutation; OpenWaggle did not modify it.')
    }
  } finally {
    await Promise.all([
      directoryHandle.close(),
      sourceHandle?.close(),
      fs.rm(workingRoot, { recursive: true, force: true }),
    ])
  }
}
