import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionBrokerTransport } from '@shared/extension-sdk-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverExtensionPackages } from '../../adapters/extensions/discovery'
import {
  activateTrustedMainExtension,
  importTrustedMainExtensionModule,
} from '../trusted-main-runtime'
import type { DiscoveredExtensionPackage } from '../types'
import { listenLocalHttpsServer } from './trusted-main-test-server'

let tmpRoot = ''

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
  readonly trustedMainPath?: string
  readonly networkOrigins?: readonly string[]
}) {
  const projectPath = path.join(tmpRoot, 'project')
  const packagePath = path.join(projectPath, '.openwaggle', 'extensions', 'sample-extension')
  const trustedMainPath = input.trustedMainPath ?? 'dist/main.mjs'

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

  return { extensionPackage, packagePath, projectPath }
}

const unusedTransport: ExtensionBrokerTransport = async () => {
  throw new Error('Unexpected broker invocation.')
}

describe('trusted main extension runtime', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-trusted-main-'))
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
      tmpRoot = ''
    }
  })

  it('imports and activates a hash-pinned trusted main entry with public SDK context', async () => {
    const eventsPath = path.join(tmpRoot, 'events.jsonl')
    const cleanupPath = path.join(tmpRoot, 'cleanup.txt')
    const { extensionPackage } = await writeTrustedMainPackage({
      mainModuleSource: `
        import { appendFile } from 'node:fs/promises'

        export async function activate(context) {
          await appendFile(${JSON.stringify(eventsPath)}, JSON.stringify({
            extensionId: context.extension.id,
            extensionName: context.extension.name,
            hasSdkInvoke: typeof context.sdk.invoke === 'function',
            hasElectronField: Object.hasOwn(context, 'electron')
          }) + '\\n')

          return () => appendFile(${JSON.stringify(cleanupPath)}, context.extension.id)
        }
      `,
    })

    const activation = await activateTrustedMainExtension({
      extensionPackage,
      contentHash: packageContentHash(extensionPackage),
      transport: unusedTransport,
    })
    await activation.cleanup?.()

    const events = await fs.readFile(eventsPath, 'utf-8')
    const cleanup = await fs.readFile(cleanupPath, 'utf-8')
    expect(events).toContain('"extensionId":"sample-extension"')
    expect(events).toContain('"extensionName":"Sample Extension"')
    expect(events).toContain('"hasSdkInvoke":true')
    expect(events).toContain('"hasElectronField":false')
    expect(cleanup).toBe('sample-extension')
  })

  it('allows trusted main HTTPS egress only to declared network origins', async () => {
    let requestCount = 0
    const server = await listenLocalHttpsServer({
      onRequest: () => {
        requestCount += 1
      },
    })

    try {
      const { extensionPackage } = await writeTrustedMainPackage({
        networkOrigins: [server.origin],
        mainModuleSource: `
          import { request } from 'node:https'

          export async function activate() {
            await new Promise((resolve, reject) => {
              const req = request(${JSON.stringify(`${server.origin}/allowed`)}, {
                rejectUnauthorized: false
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

      await activateTrustedMainExtension({
        extensionPackage,
        contentHash: packageContentHash(extensionPackage),
        transport: unusedTransport,
      })

      expect(requestCount).toBe(1)
    } finally {
      await server.close()
    }
  })

  it('denies undeclared trusted main HTTPS egress before opening a socket', async () => {
    let requestCount = 0
    const server = await listenLocalHttpsServer({
      onRequest: () => {
        requestCount += 1
      },
    })

    try {
      const { extensionPackage } = await writeTrustedMainPackage({
        mainModuleSource: `
          import { request } from 'node:https'

          export async function activate() {
            await new Promise((resolve, reject) => {
              const req = request(${JSON.stringify(`${server.origin}/denied`)}, {
                rejectUnauthorized: false
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
      ).rejects.toThrow('undeclared network egress')
      expect(requestCount).toBe(0)
    } finally {
      await server.close()
    }
  })

  it('denies trusted main fetch egress when no network origin is declared', async () => {
    const { extensionPackage } = await writeTrustedMainPackage({
      mainModuleSource: `
        export async function activate() {
          await fetch('https://api.github.com')
        }
      `,
    })

    await expect(
      activateTrustedMainExtension({
        extensionPackage,
        contentHash: packageContentHash(extensionPackage),
        transport: unusedTransport,
      }),
    ).rejects.toThrow('undeclared network egress')
  })

  it('denies trusted main raw socket egress even with named Node imports', async () => {
    const { extensionPackage } = await writeTrustedMainPackage({
      mainModuleSource: `
        import { connect } from 'node:net'

        export function activate() {
          connect({ host: '127.0.0.1', port: 443 })
        }
      `,
    })

    await expect(
      activateTrustedMainExtension({
        extensionPackage,
        contentHash: packageContentHash(extensionPackage),
        transport: unusedTransport,
      }),
    ).rejects.toThrow('Raw sockets are not permitted')
  })

  it('keeps trusted main cleanup callbacks inside the network policy', async () => {
    const { extensionPackage } = await writeTrustedMainPackage({
      mainModuleSource: `
        export function activate() {
          return () => fetch('https://api.github.com')
        }
      `,
    })

    const activation = await activateTrustedMainExtension({
      extensionPackage,
      contentHash: packageContentHash(extensionPackage),
      transport: unusedTransport,
    })

    await expect(async () => {
      await activation.cleanup?.()
    }).rejects.toThrow('undeclared network egress')
  })

  it('rejects trusted main code after its pinned content hash changes', async () => {
    const { extensionPackage, packagePath } = await writeTrustedMainPackage({
      mainModuleSource: 'export function activate() {}\n',
    })
    const pinnedHash = packageContentHash(extensionPackage)

    await writeText(path.join(packagePath, 'dist', 'main.mjs'), 'export function activate() { }\n')

    await expect(importTrustedMainExtensionModule(extensionPackage, pinnedHash)).rejects.toThrow(
      'Trusted main runtime entry for "sample-extension" is unavailable.',
    )
  })

  it('rejects modules that do not export activate(context)', async () => {
    const { extensionPackage } = await writeTrustedMainPackage({
      mainModuleSource: 'export const notActivate = true\n',
    })

    await expect(
      importTrustedMainExtensionModule(extensionPackage, packageContentHash(extensionPackage)),
    ).rejects.toThrow('Trusted main extension module must export an activate(context) function.')
  })
})
