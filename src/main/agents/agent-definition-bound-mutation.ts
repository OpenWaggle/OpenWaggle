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

const DARWIN_DEFINITION_MUTATION = `
set -eu
[ "$(/usr/bin/stat -f '%d:%i' .)" = "$5" ] || exit 73
/usr/bin/printf ready
IFS= read -r _
destination="$2"; pending="$3"; displaced="$4"
if [ "$1" != "delete" ]; then trap '/bin/rm -f -- "$pending"' EXIT; umask 077; /bin/cat <&3 > "$pending"; [ "$(/usr/bin/shasum -a 256 "$pending" | /usr/bin/awk '{print $1}')" = "$8" ] || exit 76; fi
if [ "$1" = "create" ]; then
  [ ! -e "$destination" ] && [ ! -L "$destination" ] || exit 74
  /bin/ln -h -- "$pending" "$destination"
  /bin/rm -- "$pending"
else
  /bin/mv -- "$destination" "$displaced"
  [ "$(/usr/bin/stat -f '%d:%i' "$displaced")" = "$6" ] && [ "$(/usr/bin/shasum -a 256 "$displaced" | /usr/bin/awk '{print $1}')" = "$7" ] || { /bin/ln -h -- "$displaced" "$destination"; exit 75; }
  if [ "$1" = "replace" ]; then /bin/ln -h -- "$pending" "$destination"; /bin/rm -- "$pending"; fi
  /bin/rm -- "$displaced"
fi
`

const LINUX_DEFINITION_MUTATION = `
set -eu
[ "$(/usr/bin/stat -c '%d:%i' .)" = "$5" ] || exit 73
/usr/bin/printf ready
IFS= read -r _
destination="$2"; pending="$3"; displaced="$4"
if [ "$1" != "delete" ]; then trap '/bin/rm -f -- "$pending"' EXIT; umask 077; /bin/cat <&3 > "$pending"; [ "$(/usr/bin/sha256sum "$pending" | /usr/bin/awk '{print $1}')" = "$8" ] || exit 76; fi
if [ "$1" = "create" ]; then
  [ ! -e "$destination" ] && [ ! -L "$destination" ] || exit 74
  /bin/ln -T -- "$pending" "$destination"
  /bin/rm -- "$pending"
else
  /bin/mv -- "$destination" "$displaced"
  [ "$(/usr/bin/stat -c '%d:%i' -- "$displaced")" = "$6" ] && [ "$(/usr/bin/sha256sum "$displaced" | /usr/bin/awk '{print $1}')" = "$7" ] || { /bin/ln -T -- "$displaced" "$destination"; exit 75; }
  if [ "$1" = "replace" ]; then /bin/ln -T -- "$pending" "$destination"; /bin/rm -- "$pending"; fi
  /bin/rm -- "$displaced"
fi
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
}) {
  if (process.platform === 'win32') {
    throw new Error('Secure scoped Agent definition mutation is unavailable on win32.')
  }
  const rootHandle = await fs.open(input.rootPath, OPEN_DIRECTORY_NO_FOLLOW)
  let directoryHandle: FileHandle | undefined
  try {
    directoryHandle = await fs.open(input.directory, OPEN_DIRECTORY_NO_FOLLOW)
    const directoryStats = await directoryHandle.stat()
    const rootStats = await rootHandle.stat()
    const expectedCanonicalDirectory = await fs.realpath(input.directory)
    const displaced = `.${path.basename(input.destinationPath)}.${randomUUID()}.displaced`
    await input.beforeSpawn?.()
    const child = spawn(
      '/bin/sh',
      [
        '-c',
        process.platform === 'darwin' ? DARWIN_DEFINITION_MUTATION : LINUX_DEFINITION_MUTATION,
        'openwaggle-agent-definition',
        input.mode,
        path.basename(input.destinationPath),
        input.pendingName,
        displaced,
        `${directoryStats.dev}:${directoryStats.ino}`,
        input.expectedIdentity ?? 'missing',
        input.expectedContentDigest ?? 'missing',
        input.sourceDigest ?? 'none',
      ],
      {
        env: getSafeChildEnv(),
        cwd: input.directory,
        stdio: ['pipe', 'pipe', 'ignore', input.sourceHandle?.fd ?? 'ignore'],
      },
    )
    const exitCodePromise = waitForChildExit(child)
    try {
      await validateDefinitionDirectory({
        rootPath: input.rootPath,
        directory: input.directory,
        rootStats,
        directoryStats,
        expectedDirectoryIdentity: input.expectedDirectoryIdentity,
        expectedCanonicalDirectory,
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
      throw new Error(`Descriptor-bound Agent definition mutation failed (${exitCode}).`)
    }
  } finally {
    await Promise.all([rootHandle.close(), directoryHandle?.close()])
  }
}
