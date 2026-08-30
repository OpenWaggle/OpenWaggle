import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import { link, open, realpath, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { getSafeChildEnv } from '../env'
import { assertFilesystemWriteScope } from '../utils/filesystem-write-scope'
import {
  abortValidatedChild,
  releaseValidatedChild,
  waitForChildExit,
} from '../utils/validated-child-process'

const INSTALL_DIAGNOSTIC_LIMIT = 4096

const DARWIN_BOUND_INSTALL = `
set -eu
actual_directory=$(/usr/bin/stat -f '%d:%i' .)
[ "$actual_directory" = "$3" ] || exit 73
actual_source=$(/usr/bin/stat -f '%d:%i' "$1")
[ "$actual_source" = "$4" ] || exit 74
/usr/bin/printf ready
IFS= read -r _
if [ "$5" = "overwrite" ]; then
  /bin/rm -f -- "$2"
  /bin/ln -h -- "$1" "$2"
  /bin/rm -- "$1"
else
  /bin/ln -h -- "$1" "$2"
  /bin/rm -- "$1"
fi
`

const LINUX_BOUND_INSTALL = `
set -eu
actual_directory=$(/usr/bin/stat -c '%d:%i' .)
[ "$actual_directory" = "$3" ] || exit 73
actual_source=$(/usr/bin/stat -c '%d:%i' -- "$1")
[ "$actual_source" = "$4" ] || exit 74
/usr/bin/printf ready
IFS= read -r _
if [ "$5" = "overwrite" ]; then
  /bin/rm -f -- "$2"
  /bin/ln -T -- "$1" "$2"
  /bin/rm -- "$1"
else
  /bin/ln -T -- "$1" "$2"
  /bin/rm -- "$1"
fi
`

const DARWIN_BOUND_COPY_INSTALL = `
set -eu
[ "$(/usr/bin/stat -f '%d:%i' .)" = "$3" ] || exit 73
/usr/bin/printf ready
IFS= read -r _
trap '/bin/rm -f -- "$1"' EXIT
umask 077
/bin/cat <&3 > "$1"
[ "$(/usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}')" = "$4" ] || exit 74
if [ "$5" = "overwrite" ]; then /bin/rm -f -- "$2"; /bin/ln -h -- "$1" "$2"; /bin/rm -- "$1"; else /bin/ln -h -- "$1" "$2"; /bin/rm -- "$1"; fi
`

const LINUX_BOUND_COPY_INSTALL = `
set -eu
[ "$(/usr/bin/stat -c '%d:%i' .)" = "$3" ] || exit 73
/usr/bin/printf ready
IFS= read -r _
trap '/bin/rm -f -- "$1"' EXIT
umask 077
/bin/cat <&3 > "$1"
[ "$(/usr/bin/sha256sum "$1" | /usr/bin/awk '{print $1}')" = "$4" ] || exit 74
if [ "$5" = "overwrite" ]; then /bin/rm -f -- "$2"; /bin/ln -T -- "$1" "$2"; /bin/rm -- "$1"; else /bin/ln -T -- "$1" "$2"; /bin/rm -- "$1"; fi
`

interface BoundArtifactInstallInput {
  readonly sourcePath: string
  readonly destinationPath: string
  readonly destinationRoot?: string
  readonly overwriteExisting: boolean
  readonly expectedArtifact: { readonly dev: number | bigint; readonly ino: number | bigint }
  readonly platform?: NodeJS.Platform
  readonly afterSpawn?: () => Promise<void>
}

interface BoundArtifactDescriptorInstallInput {
  readonly sourceHandle: FileHandle
  readonly sourceDigest: string
  readonly destinationPath: string
  readonly destinationRoot: string
  readonly overwriteExisting: boolean
  readonly platform?: NodeJS.Platform
  readonly afterSpawn?: () => Promise<void>
  /** Test-only interleaving point before the helper pins its working directory. */
  readonly beforeSpawn?: () => Promise<void>
}

export function sameFilesystemEntry(
  left: { readonly dev: number | bigint; readonly ino: number | bigint },
  right: { readonly dev: number | bigint; readonly ino: number | bigint },
) {
  return BigInt(left.dev) === BigInt(right.dev) && BigInt(left.ino) === BigInt(right.ino)
}

async function openDirectoryNoFollow(directory: string) {
  const { constants } = await import('node:fs')
  return open(
    directory,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
  )
}

async function installUnscopedWindowsArtifact(input: BoundArtifactInstallInput) {
  if (input.destinationRoot) {
    throw new Error(
      'Secure scoped artifact installation is unavailable on win32 because descriptor-relative rename is not supported; use streaming stdout export instead.',
    )
  }
  if (input.overwriteExisting) {
    await rename(input.sourcePath, input.destinationPath)
    return
  }
  await link(input.sourcePath, input.destinationPath)
  await unlink(input.sourcePath)
}

async function assertAuthorizedDestination(input: BoundArtifactInstallInput) {
  if (!input.destinationRoot) return
  const canonicalDestination = path.join(
    await realpath(path.dirname(input.destinationPath)),
    path.basename(input.destinationPath),
  )
  const scope = await assertFilesystemWriteScope({
    roots: [input.destinationRoot],
    destinationPath: canonicalDestination,
  })
  if (
    path.resolve(scope.rootPath) !== path.resolve(input.destinationRoot) ||
    path.resolve(scope.destinationPath) !== path.resolve(canonicalDestination)
  ) {
    throw new Error('The export destination no longer matches its authorized filesystem scope.')
  }
}

async function assertDirectoryStillBound(
  directory: string,
  expectedDirectory: { readonly dev: number | bigint; readonly ino: number | bigint },
) {
  const currentDirectory = await stat(directory, { bigint: true })
  if (!sameFilesystemEntry(expectedDirectory, currentDirectory)) {
    throw new Error('The export destination directory changed during installation.')
  }
}

function boundInstallArguments(
  input: BoundArtifactInstallInput,
  directoryStats: { readonly dev: number | bigint; readonly ino: number | bigint },
) {
  return [
    '-c',
    (input.platform ?? process.platform) === 'darwin' ? DARWIN_BOUND_INSTALL : LINUX_BOUND_INSTALL,
    'openwaggle-export-install',
    path.basename(input.sourcePath),
    path.basename(input.destinationPath),
    `${directoryStats.dev}:${directoryStats.ino}`,
    `${input.expectedArtifact.dev}:${input.expectedArtifact.ino}`,
    input.overwriteExisting ? 'overwrite' : 'create',
  ]
}

async function runBoundInstall(
  input: BoundArtifactInstallInput,
  directory: string,
  directoryStats: { readonly dev: number | bigint; readonly ino: number | bigint },
) {
  const child = spawn('/bin/sh', boundInstallArguments(input, directoryStats), {
    cwd: directory,
    env: getSafeChildEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let diagnostic = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    if (diagnostic.length >= INSTALL_DIAGNOSTIC_LIMIT) return
    diagnostic += chunk.slice(0, INSTALL_DIAGNOSTIC_LIMIT - diagnostic.length)
  })
  const exitCodePromise = waitForChildExit(child)
  await releaseValidatedChild({
    child,
    label: 'Descriptor-bound export helper',
    ...(input.afterSpawn ? { afterValidation: input.afterSpawn } : {}),
  })
  const exitCode = await exitCodePromise
  if (exitCode === 0) return
  throw new Error(
    `The descriptor-bound export installation failed with exit code ${exitCode}${diagnostic ? `: ${diagnostic.trim()}` : '.'}`,
  )
}

export async function installArtifactInBoundDirectory(input: BoundArtifactInstallInput) {
  const directory = path.dirname(input.destinationPath)
  if (path.dirname(input.sourcePath) !== directory) {
    throw new Error('The staged export artifact must share its destination directory.')
  }
  if ((input.platform ?? process.platform) === 'win32') {
    await installUnscopedWindowsArtifact(input)
    return
  }
  if (input.destinationRoot) {
    throw new Error('Scoped export installation requires an open staging descriptor.')
  }
  const directoryHandle = await openDirectoryNoFollow(directory)
  try {
    const directoryStats = await directoryHandle.stat({ bigint: true })
    await assertAuthorizedDestination(input)
    await assertDirectoryStillBound(directory, directoryStats)
    await runBoundInstall(input, directory, directoryStats)
  } finally {
    await directoryHandle.close()
  }
}

export async function installArtifactDescriptorInBoundDirectory(
  input: BoundArtifactDescriptorInstallInput,
) {
  const platform = input.platform ?? process.platform
  if (platform === 'win32') {
    throw new Error(
      'Secure scoped artifact installation is unavailable on win32; use streaming stdout export instead.',
    )
  }
  const directory = path.dirname(input.destinationPath)
  const directoryHandle = await openDirectoryNoFollow(directory)
  let rootHandle: FileHandle | undefined
  try {
    rootHandle = await openDirectoryNoFollow(input.destinationRoot)
    const directoryStats = await directoryHandle.stat({ bigint: true })
    await rootHandle.stat({ bigint: true })
    const expectedCanonicalDirectory = await realpath(directory)
    const pendingName = `.openwaggle-export-${randomUUID()}.pending`
    const script = platform === 'darwin' ? DARWIN_BOUND_COPY_INSTALL : LINUX_BOUND_COPY_INSTALL
    const scriptArguments =
      platform === 'darwin'
        ? [
            '-c',
            script,
            'openwaggle-export-copy-install',
            pendingName,
            path.basename(input.destinationPath),
            `${directoryStats.dev}:${directoryStats.ino}`,
            input.sourceDigest,
            input.overwriteExisting ? 'overwrite' : 'create',
          ]
        : [
            '-c',
            script,
            'openwaggle-export-copy-install',
            pendingName,
            path.basename(input.destinationPath),
            `${directoryStats.dev}:${directoryStats.ino}`,
            input.sourceDigest,
            input.overwriteExisting ? 'overwrite' : 'create',
          ]
    await input.beforeSpawn?.()
    const child = spawn('/bin/sh', scriptArguments, {
      cwd: directory,
      env: getSafeChildEnv(),
      stdio: ['pipe', 'pipe', 'pipe', input.sourceHandle.fd],
    })
    const exitCodePromise = waitForChildExit(child)
    try {
      await assertAuthorizedDestination({
        sourcePath: input.destinationPath,
        destinationPath: input.destinationPath,
        destinationRoot: input.destinationRoot,
        overwriteExisting: input.overwriteExisting,
        expectedArtifact: { dev: 0, ino: 0 },
      })
      if ((await realpath(directory)) !== expectedCanonicalDirectory) {
        throw new Error('The export destination directory changed during installation.')
      }
      await assertDirectoryStillBound(directory, directoryStats)
      await releaseValidatedChild({
        child,
        label: 'Descriptor-bound export copy helper',
        ...(input.afterSpawn ? { afterValidation: input.afterSpawn } : {}),
      })
    } catch (error) {
      await abortValidatedChild(child, exitCodePromise)
      throw error
    }
    const exitCode = await exitCodePromise
    if (exitCode !== 0) {
      throw new Error(`The descriptor-bound export copy-install failed (${exitCode}).`)
    }
  } finally {
    await Promise.all([directoryHandle.close(), rootHandle?.close()])
  }
}
