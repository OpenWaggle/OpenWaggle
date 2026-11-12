import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTemporaryEntries } from '../../test-support/temporary-test-directory'
import {
  activateTrustedMainPackage,
  writeTrustedMainPackage as writeTrustedMainPackageIn,
} from './trusted-main-test-package'

// The runtime stages trusted entries in one cache directory per process, in the temp directory.
afterAll(() => removeTemporaryEntries('openwaggle-trusted-main-'))

let tmpRoot = ''

function writeTrustedMainPackage(input: {
  readonly mainModuleSource: string
  readonly networkOrigins?: readonly string[]
}) {
  return writeTrustedMainPackageIn({ root: tmpRoot, ...input })
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

    await expect(activateTrustedMainPackage(extensionPackage)).rejects.toThrow(
      'Custom DNS lookup functions can bypass the declared origin',
    )
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

    await expect(activateTrustedMainPackage(extensionPackage)).rejects.toThrow(
      'Custom fetch dispatchers can bypass the declared origin',
    )
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

    await expect(activateTrustedMainPackage(extensionPackage)).rejects.toThrow(
      'Request objects can preserve custom fetch agents or dispatchers',
    )
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

    await expect(activateTrustedMainPackage(extensionPackage)).rejects.toThrow('Unix socket')
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

    await expect(activateTrustedMainPackage(extensionPackage)).rejects.toThrow(
      'Child processes can bypass declared network origins',
    )
  })

  it('keeps externally emitted trusted main callbacks inside the network policy', async () => {
    const eventName = 'openwaggle-test-trusted-main-external-callback'
    const outcomeKey = 'openwaggleTestTrustedMainExternalCallbackOutcome'
    const extensionPackage = await writeTrustedMainPackage({
      networkOrigins: ['https://api.github.com'],
      mainModuleSource: `
        import { spawnSync } from 'node:child_process'

        export function activate() {
          process.once(${JSON.stringify(eventName)}, () => {
            // Node's guard throws; Bun's spawnSync reports the denial in result.error, as it does
            // any failure to start the process. Bun's native process.emit does not rethrow a
            // listener's error, so the listener records the outcome.
            try {
              const result = spawnSync(process.execPath, ['-e', ''])
              globalThis[${JSON.stringify(outcomeKey)}] = result.error?.message ?? 'spawned'
            } catch (error) {
              globalThis[${JSON.stringify(outcomeKey)}] = error.message
            }
          })
        }
      `,
    })

    await activateTrustedMainPackage(extensionPackage)

    try {
      Reflect.apply(process.emit, process, [eventName])
      expect(Reflect.get(globalThis, outcomeKey)).toContain(
        'Child processes can bypass declared network origins',
      )
    } finally {
      Reflect.deleteProperty(globalThis, outcomeKey)
    }
  })

  it('denies trusted main UDP socket network escape hatches', async () => {
    const extensionPackage = await writeTrustedMainPackage({
      networkOrigins: ['https://api.github.com'],
      mainModuleSource: `
        import { createSocket } from 'node:dgram'

        export function activate() {
          // Bun cannot intercept constructing a UDP socket object; it opens no OS socket until it
          // binds, which send does first.
          createSocket('udp4').send('probe', 9, '127.0.0.1')
        }
      `,
    })

    await expect(activateTrustedMainPackage(extensionPackage)).rejects.toThrow(
      'UDP sockets are not permitted',
    )
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

    await expect(activateTrustedMainPackage(extensionPackage)).rejects.toThrow(
      'Direct DNS resolution can bypass declared network origins',
    )
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

    await expect(activateTrustedMainPackage(extensionPackage)).rejects.toThrow(
      'HTTP/2 clients are not permitted',
    )
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

    await expect(activateTrustedMainPackage(extensionPackage)).rejects.toThrow(
      'Worker threads can bypass trusted main network guards',
    )
  })
})
