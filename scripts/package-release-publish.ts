import { execFile } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const EXPECTED_ARGUMENT_COUNT = 1
const CLI_ARGUMENT_START_INDEX = 2

export async function validatedPackageReleaseTarballPath(args: readonly string[]) {
  if (args.length !== EXPECTED_ARGUMENT_COUNT) {
    throw new Error('Expected exactly one validated tarball path.')
  }

  const tarballPath = args[0]
  if (!tarballPath || !path.isAbsolute(tarballPath) || path.extname(tarballPath) !== '.tgz') {
    throw new Error('Validated tarball path must be an absolute .tgz file.')
  }

  const stats = await lstat(tarballPath)
  if (!stats.isFile()) {
    throw new Error('Validated tarball path must identify one regular, non-symlink file.')
  }

  return tarballPath
}

function publishValidatedTarball(tarballPath: string) {
  return new Promise<void>((resolve, reject) => {
    execFile(
      'npm',
      [
        'publish',
        tarballPath,
        '--registry',
        'https://registry.npmjs.org/',
        '--access',
        'public',
        '--provenance',
        '--tag',
        'latest',
      ],
      (error, stdout, stderr) => {
        if (stdout) process.stdout.write(stdout)
        if (stderr) process.stderr.write(stderr)
        if (error) {
          reject(error)
          return
        }
        resolve()
      },
    )
  })
}

export async function publishPackageRelease(args: readonly string[]) {
  const tarballPath = await validatedPackageReleaseTarballPath(args)
  await publishValidatedTarball(tarballPath)
}

export async function runPackageReleasePublishCli(
  args: readonly string[],
  reportError: (message: string) => void = console.error,
) {
  try {
    await publishPackageRelease(args)
    return 0
  } catch (error) {
    reportError(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runPackageReleasePublishCli(process.argv.slice(CLI_ARGUMENT_START_INDEX)).then((exitCode) => {
    process.exitCode = exitCode
  })
}
