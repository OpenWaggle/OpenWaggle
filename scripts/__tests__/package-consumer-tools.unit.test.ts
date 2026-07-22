import { createHash } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  installPackageConsumerTools,
  verifyDownloadedPackageIntegrity,
  verifyPackageConsumerTools,
} from '../package-consumer-tools'

describe('package consumer tools', () => {
  it('pins the official registry, package integrities, and isolated install prefix', async () => {
    const commands: { readonly command: string; readonly args: readonly string[] }[] = []
    const pathWrites: { readonly filePath: string; readonly contents: string }[] = []
    const verifiedPackages: { readonly filePath: string; readonly integrity: string }[] = []
    await installPackageConsumerTools(
      { toolRoot: '/tmp/tools', githubPath: '/tmp/github-path' },
      {
        runCommand: async (command, args) => {
          commands.push({ command, args })
          if (args[0] !== 'pack') return ''
          const filename = args[1] === 'npm@11.18.0' ? 'npm-11.18.0.tgz' : 'yarnpkg-cli-dist-4.17.1.tgz'
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
    expect(commands[0]?.args).toEqual(expect.arrayContaining([
      'pack',
      'npm@11.18.0',
      '--json',
      '--ignore-scripts',
      '--pack-destination=/tmp/tools/downloads',
      '--registry=https://registry.npmjs.org/',
    ]))
    expect(commands[1]?.args).toEqual(expect.arrayContaining([
      'pack',
      '@yarnpkg/cli-dist@4.17.1',
      '--json',
      '--ignore-scripts',
      '--pack-destination=/tmp/tools/downloads',
      '--registry=https://registry.npmjs.org/',
    ]))
    expect(commands[2]?.args).toEqual(expect.arrayContaining([
      '--global',
      '--ignore-scripts',
      '--prefix=/tmp/tools',
      '--registry=https://registry.npmjs.org/',
      '/tmp/tools/downloads/npm-11.18.0.tgz',
      '/tmp/tools/downloads/yarnpkg-cli-dist-4.17.1.tgz',
    ]))
    expect(verifiedPackages).toHaveLength(2)
    expect(pathWrites).toEqual([{ filePath: '/tmp/github-path', contents: '/tmp/tools/bin\n' }])
  })

  it('fails before installation when downloaded package integrity changes', async () => {
    await expect(installPackageConsumerTools(
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
    )).rejects.toThrow('integrity mismatch')
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
      ['pnpm', '11.6.0'],
      ['bun', '1.3.14'],
    ])
    await verifyPackageConsumerTools('/tmp/tools', {
      resolveExecutable: async (name) => name === 'npm' || name === 'yarn'
        ? join('/tmp/tools', 'bin', name)
        : `/usr/bin/${name}`,
      runCommand: async (command) => versions.get(command.split('/').at(-1) ?? '') ?? '',
    })
  })
})
