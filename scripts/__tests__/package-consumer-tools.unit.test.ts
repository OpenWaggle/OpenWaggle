import { createHash } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  installPackageConsumerTools,
  resolveToolRoot,
  verifyDownloadedPackageIntegrity,
  verifyPackageConsumerTools,
} from '../package-consumer-tools'

const REPOSITORY_ROOT = process.cwd()

/** pnpm refuses to run under a package.json that pins another package manager. */
function refuseInsideRepository(cwd: string) {
  const fromRepository = relative(REPOSITORY_ROOT, cwd)
  if (!fromRepository.startsWith('..')) {
    throw new Error('[ERROR] This project is configured to use bun')
  }
}

describe('package consumer tools', () => {
  it('pins the official registry, package integrities, and isolated install prefix', async () => {
    const commands: {
      readonly command: string
      readonly args: readonly string[]
      readonly cwd: string
    }[] = []
    const pathWrites: { readonly filePath: string; readonly contents: string }[] = []
    const verifiedPackages: { readonly filePath: string; readonly integrity: string }[] = []
    await installPackageConsumerTools(
      { toolRoot: '/tmp/tools', githubPath: '/tmp/github-path' },
      {
        runCommand: async (command, args, cwd) => {
          refuseInsideRepository(cwd)
          commands.push({ command, args, cwd })
          if (args[0] !== 'pack') return ''
          const filename =
            args[1] === 'npm@11.18.0' ? 'npm-11.18.0.tgz' : 'yarnpkg-cli-dist-4.17.1.tgz'
          return JSON.stringify([{ filename }])
        },
        appendSearchPath: async (filePath, contents) => {
          pathWrites.push({ filePath, contents })
        },
        prepareDirectory: async () => undefined,
        verifyDownloadedPackage: async (filePath, integrity) => {
          verifiedPackages.push({ filePath, integrity })
        },
        writeUserConfig: async () => undefined,
      },
    )

    expect(commands).toHaveLength(3)
    expect(commands[0]?.args).toEqual(
      expect.arrayContaining([
        'pack',
        'npm@11.18.0',
        '--json',
        '--ignore-scripts',
        '--pack-destination=/tmp/tools/downloads',
        '--registry=https://registry.npmjs.org/',
      ]),
    )
    expect(commands[1]?.args).toEqual(
      expect.arrayContaining([
        'pack',
        '@yarnpkg/cli-dist@4.17.1',
        '--json',
        '--ignore-scripts',
        '--pack-destination=/tmp/tools/downloads',
        '--registry=https://registry.npmjs.org/',
      ]),
    )
    expect(commands[2]?.args).toEqual(
      expect.arrayContaining([
        '--global',
        '--ignore-scripts',
        '--prefix=/tmp/tools',
        '--registry=https://registry.npmjs.org/',
        '/tmp/tools/downloads/npm-11.18.0.tgz',
        '/tmp/tools/downloads/yarnpkg-cli-dist-4.17.1.tgz',
      ]),
    )
    expect(commands.map(({ cwd }) => cwd)).toEqual(['/tmp/tools', '/tmp/tools', '/tmp/tools'])
    expect(verifiedPackages).toHaveLength(2)
    expect(pathWrites).toEqual([{ filePath: '/tmp/github-path', contents: '/tmp/tools/bin\n' }])
  })

  it('fails before installation when downloaded package integrity changes', async () => {
    await expect(
      installPackageConsumerTools(
        { toolRoot: '/tmp/tools', githubPath: '/tmp/github-path' },
        {
          runCommand: async () => JSON.stringify([{ filename: 'package.tgz' }]),
          appendSearchPath: async () => undefined,
          prepareDirectory: async () => undefined,
          verifyDownloadedPackage: async () => {
            throw new Error('integrity mismatch')
          },
          writeUserConfig: async () => undefined,
        },
      ),
    ).rejects.toThrow('integrity mismatch')
  })

  it('computes SHA-512 over the downloaded tarball bytes', async () => {
    const contents = Buffer.from('trusted package bytes')
    const integrity = `sha512-${createHash('sha512').update(contents).digest('base64')}`
    const filePath = join('/tmp', `openwaggle-integrity-${process.pid}.tgz`)
    await writeFile(filePath, contents)
    try {
      await expect(verifyDownloadedPackageIntegrity(filePath, integrity)).resolves.toBeUndefined()
      await expect(verifyDownloadedPackageIntegrity(filePath, 'sha512-untrusted')).rejects.toThrow(
        'integrity mismatch',
      )
    } finally {
      await rm(filePath, { force: true })
    }
  })

  it('verifies isolated npm and Yarn plus existing pnpm and Bun versions', async () => {
    const versions = new Map([
      ['npm', '11.18.0'],
      ['yarn', '4.17.1'],
      ['pnpm', '11.15.1'],
      ['bun', '1.4.4'],
    ])
    const workingDirectories: string[] = []
    await verifyPackageConsumerTools('/tmp/tools', {
      resolveExecutable: async (name) =>
        name === 'npm' || name === 'yarn' ? join('/tmp/tools', 'bin', name) : `/usr/bin/${name}`,
      runCommand: async (command, _args, cwd) => {
        refuseInsideRepository(cwd)
        workingDirectories.push(cwd)
        return versions.get(command.split('/').at(-1) ?? '') ?? ''
      },
    })
    expect(workingDirectories).toEqual(['/tmp/tools', '/tmp/tools', '/tmp/tools', '/tmp/tools'])
  })

  it('resolves the tool root outside the repository and rejects one inside it', () => {
    expect(resolveToolRoot('/tmp/tools', '/work/repo')).toBe('/tmp/tools')
    expect(resolveToolRoot('../tools', '/work/repo')).toBe('/work/tools')
    expect(resolveToolRoot('/work/repo-tools', '/work/repo')).toBe('/work/repo-tools')
    for (const insideRoot of ['/work/repo', '/work/repo/.tmp/tools', 'tools', '..tools']) {
      expect(() => resolveToolRoot(insideRoot, '/work/repo')).toThrow(
        '--tool-root must be outside the repository',
      )
    }
  })
})
