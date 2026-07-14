import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ execFile: execFileMock }))

import {
  publishPackageRelease,
  runPackageReleasePublishCli,
  validatedPackageReleaseTarballPath,
} from '../package-release-publish'

const temporaryDirectories: string[] = []

async function temporaryTarball() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-release-publish-'))
  temporaryDirectories.push(directory)
  const tarballPath = path.join(directory, 'openwaggle-extension-sdk-0.1.0.tgz')
  await writeFile(tarballPath, 'package tarball')
  return { directory, tarballPath }
}

afterEach(async () => {
  execFileMock.mockReset()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('package release publisher', () => {
  it('publishes one validated tarball with a fixed trusted-publication argv', async () => {
    const { tarballPath } = await temporaryTarball()
    execFileMock.mockImplementation((_file, _args, callback) => {
      callback(null, '', '')
    })

    await publishPackageRelease([tarballPath])

    expect(execFileMock).toHaveBeenCalledOnce()
    expect(execFileMock).toHaveBeenCalledWith(
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
      expect.any(Function),
    )
  })

  it.each([[[]], [['first.tgz', 'second.tgz']]])(
    'rejects argument lists that do not identify exactly one tarball',
    async (args) => {
      await expect(validatedPackageReleaseTarballPath(args)).rejects.toThrow(
        'Expected exactly one validated tarball path.',
      )
      expect(execFileMock).not.toHaveBeenCalled()
    },
  )

  it('rejects relative, non-tgz, missing, and symlink paths', async () => {
    const { directory, tarballPath } = await temporaryTarball()
    const symlinkPath = path.join(directory, 'linked.tgz')
    await symlink(tarballPath, symlinkPath)

    await expect(validatedPackageReleaseTarballPath(['relative.tgz'])).rejects.toThrow()
    await expect(
      validatedPackageReleaseTarballPath([path.join(directory, 'package.zip')]),
    ).rejects.toThrow()
    await expect(
      validatedPackageReleaseTarballPath([path.join(directory, 'missing.tgz')]),
    ).rejects.toThrow()
    await expect(validatedPackageReleaseTarballPath([symlinkPath])).rejects.toThrow(
      'Validated tarball path must identify one regular, non-symlink file.',
    )
  })

  it('propagates npm publication failures', async () => {
    const { tarballPath } = await temporaryTarball()
    const publicationError = new Error('npm publication failed')
    execFileMock.mockImplementation((_file, _args, callback) => {
      callback(publicationError, '', '')
    })

    await expect(publishPackageRelease([tarballPath])).rejects.toBe(publicationError)
  })

  it('reports rejected CLI input and returns a nonzero exit code', async () => {
    const reportError = vi.fn()

    const exitCode = await runPackageReleasePublishCli(['relative.tgz'], reportError)

    expect(exitCode).toBe(1)
    expect(reportError).toHaveBeenCalledWith(
      'Validated tarball path must be an absolute .tgz file.',
    )
    expect(execFileMock).not.toHaveBeenCalled()
  })
})
