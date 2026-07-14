import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionBrokerTransport } from '@shared/extension-sdk-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverExtensionPackages } from '../../adapters/extensions/discovery'
import { activateTrustedMainExtension } from '../trusted-main-runtime'
import type { DiscoveredExtensionPackage } from '../types'

let tmpRoot = ''

const unusedTransport: ExtensionBrokerTransport = async () => {
  throw new Error('Unexpected broker invocation.')
}

async function writeText(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, value, 'utf-8')
}

async function writeJson(filePath: string, value: unknown) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function packageContentHash(extensionPackage: DiscoveredExtensionPackage) {
  if (extensionPackage.contentHash === null) {
    throw new Error('Expected extension package content hash.')
  }
  return extensionPackage.contentHash
}

async function writeTrustedMainPackage(input: {
  readonly mainModuleSource: string
  readonly networkOrigins?: readonly string[]
}) {
  const projectPath = path.join(tmpRoot, 'project')
  const packagePath = path.join(projectPath, '.openwaggle', 'extensions', 'sample-extension')
  const trustedMainPath = 'dist/main.mjs'

  await writeJson(path.join(packagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE), {
    manifestVersion: 1,
    id: 'sample-extension',
    name: 'Sample Extension',
    version: '1.0.0',
    sdk: { openwaggle: '>=0.1.0 <0.2.0' },
    sourceFiles: ['src/index.ts'],
    builtArtifacts: [trustedMainPath],
    trusted: {
      main: trustedMainPath,
    },
    ...(input.networkOrigins !== undefined ? { network: { origins: input.networkOrigins } } : {}),
  })
  await writeText(path.join(packagePath, 'src', 'index.ts'), 'export const source = true\n')
  await writeText(path.join(packagePath, trustedMainPath), input.mainModuleSource)

  const packages = await discoverExtensionPackages({
    projectPath,
    hostSdkVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
  })
  const extensionPackage = packages[0]
  if (!extensionPackage) {
    throw new Error('Expected discovered extension package.')
  }

  return extensionPackage
}

describe('trusted main extension runtime network policy', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-trusted-main-network-'))
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
      tmpRoot = ''
    }
  })

  it('denies trusted main HTTPS egress with custom DNS lookup', async () => {
    const extensionPackage = await writeTrustedMainPackage({
      networkOrigins: ['https://api.github.com'],
      mainModuleSource: `
        import { request } from 'node:https'

        export async function activate() {
          await new Promise((resolve, reject) => {
            const req = request('https://api.github.com/allowed', {
              lookup: (_hostname, _options, callback) => callback(null, '127.0.0.1', 4)
            }, (response) => {
              response.resume()
              response.on('end', resolve)
            })
            req.on('error', reject)
            req.end()
          })
        }
      `,
    })

    await expect(
      activateTrustedMainExtension({
        extensionPackage,
        contentHash: packageContentHash(extensionPackage),
        transport: unusedTransport,
      }),
    ).rejects.toThrow('Custom DNS lookup functions can bypass the declared origin')
  })

  it('denies trusted main fetch egress with custom dispatchers', async () => {
    const extensionPackage = await writeTrustedMainPackage({
      networkOrigins: ['https://api.github.com'],
      mainModuleSource: `
        export async function activate() {
          await fetch('https://api.github.com', {
            dispatcher: {
              dispatch() {
                throw new Error('Dispatcher should not be used.')
              }
            }
          })
        }
      `,
    })

    await expect(
      activateTrustedMainExtension({
        extensionPackage,
        contentHash: packageContentHash(extensionPackage),
        transport: unusedTransport,
      }),
    ).rejects.toThrow('Custom fetch dispatchers can bypass the declared origin')
  })

  it('denies trusted main fetch egress when a Request carries custom dispatchers', async () => {
    const extensionPackage = await writeTrustedMainPackage({
      networkOrigins: ['https://api.github.com'],
      mainModuleSource: `
        export async function activate() {
          const request = new Request('https://api.github.com', {
            dispatcher: {
              dispatch() {
                throw new Error('Dispatcher should not be used.')
              }
            }
          })
          await fetch(request)
        }
      `,
    })

    await expect(
      activateTrustedMainExtension({
        extensionPackage,
        contentHash: packageContentHash(extensionPackage),
        transport: unusedTransport,
      }),
    ).rejects.toThrow('Request objects can preserve custom fetch agents or dispatchers')
  })

  it('denies trusted main Unix socket paths before opening a socket', async () => {
    const extensionPackage = await writeTrustedMainPackage({
      networkOrigins: ['https://localhost'],
      mainModuleSource: `
        import { request } from 'node:https'

        export async function activate() {
          request({
            protocol: 'https:',
            hostname: 'localhost',
            socketPath: '/tmp/openwaggle-extension-test.sock',
            path: '/'
          }).end()
        }
      `,
    })

    await expect(
      activateTrustedMainExtension({
        extensionPackage,
        contentHash: packageContentHash(extensionPackage),
        transport: unusedTransport,
      }),
    ).rejects.toThrow('Unix socket')
  })

  it('denies trusted main child process network escape hatches', async () => {
    const extensionPackage = await writeTrustedMainPackage({
      networkOrigins: ['https://api.github.com'],
      mainModuleSource: `
        import { spawn } from 'node:child_process'

        export function activate() {
          spawn(process.execPath, ['-e', ''])
        }
      `,
    })

    await expect(
      activateTrustedMainExtension({
        extensionPackage,
        contentHash: packageContentHash(extensionPackage),
        transport: unusedTransport,
      }),
    ).rejects.toThrow('Child processes can bypass declared network origins')
  })

  it('keeps externally emitted trusted main callbacks inside the network policy', async () => {
    const eventName = 'openwaggle-test-trusted-main-external-callback'
    const extensionPackage = await writeTrustedMainPackage({
      networkOrigins: ['https://api.github.com'],
      mainModuleSource: `
        import { spawnSync } from 'node:child_process'

        export function activate() {
          process.once(${JSON.stringify(eventName)}, () => {
            spawnSync(process.execPath, ['-e', ''])
          })
        }
      `,
    })

    await activateTrustedMainExtension({
      extensionPackage,
      contentHash: packageContentHash(extensionPackage),
      transport: unusedTransport,
    })

    expect(() => process.emit(eventName)).toThrow(
      'Child processes can bypass declared network origins',
    )
  })

  it('denies trusted main UDP socket network escape hatches', async () => {
    const extensionPackage = await writeTrustedMainPackage({
      networkOrigins: ['https://api.github.com'],
      mainModuleSource: `
        import { createSocket } from 'node:dgram'

        export function activate() {
          createSocket('udp4')
        }
      `,
    })

    await expect(
      activateTrustedMainExtension({
        extensionPackage,
        contentHash: packageContentHash(extensionPackage),
        transport: unusedTransport,
      }),
    ).rejects.toThrow('UDP sockets are not permitted')
  })

  it('denies trusted main direct DNS resolution network escape hatches', async () => {
    const extensionPackage = await writeTrustedMainPackage({
      networkOrigins: ['https://api.github.com'],
      mainModuleSource: `
        import { resolve4 } from 'node:dns/promises'

        export async function activate() {
          await resolve4('example.com')
        }
      `,
    })

    await expect(
      activateTrustedMainExtension({
        extensionPackage,
        contentHash: packageContentHash(extensionPackage),
        transport: unusedTransport,
      }),
    ).rejects.toThrow('Direct DNS resolution can bypass declared network origins')
  })

  it('denies trusted main HTTP/2 network escape hatches', async () => {
    const extensionPackage = await writeTrustedMainPackage({
      networkOrigins: ['https://api.github.com'],
      mainModuleSource: `
        import { connect } from 'node:http2'

        export function activate() {
          connect('https://api.github.com')
        }
      `,
    })

    await expect(
      activateTrustedMainExtension({
        extensionPackage,
        contentHash: packageContentHash(extensionPackage),
        transport: unusedTransport,
      }),
    ).rejects.toThrow('HTTP/2 clients are not permitted')
  })

  it('denies trusted main worker thread network escape hatches', async () => {
    const extensionPackage = await writeTrustedMainPackage({
      networkOrigins: ['https://api.github.com'],
      mainModuleSource: `
        import { Worker } from 'node:worker_threads'

        export function activate() {
          new Worker('export {}', { eval: true, type: 'module' })
        }
      `,
    })

    await expect(
      activateTrustedMainExtension({
        extensionPackage,
        contentHash: packageContentHash(extensionPackage),
        transport: unusedTransport,
      }),
    ).rejects.toThrow('Worker threads can bypass trusted main network guards')
  })
})
