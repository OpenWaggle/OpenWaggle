import fs from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { removeTemporaryEntries } from '../../test-support/temporary-test-directory'
import {
  activate,
  BUILTIN_CASES,
  BUN_CASES,
  RAW_SOCKET,
  RUNS_ON_BUN,
} from './trusted-main-egress-cases'
import { activateTrustedMainPackage, writeTrustedMainPackage } from './trusted-main-test-package'
import { listenLocalHttpsServer } from './trusted-main-test-server'

// The runtime stages trusted entries in one cache directory per process, in the temp directory.
afterAll(() => removeTemporaryEntries('openwaggle-trusted-main-'))

describe('trusted main extension network egress paths', () => {
  let tmpRoot = ''
  let rawServer: Server | null = null
  let rawPort = 0
  let rawConnections = 0

  function writePackage(input: { readonly source: string; readonly origins: readonly string[] }) {
    return writeTrustedMainPackage({
      root: tmpRoot,
      networkOrigins: input.origins,
      mainModuleSource: input.source.replaceAll('RAW_PORT', String(rawPort)),
    })
  }

  beforeAll(async () => {
    const server = createServer((socket) => {
      rawConnections += 1
      socket.destroy()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Expected the raw server to listen on a TCP port.')
    }
    rawServer = server
    rawPort = address.port
  })

  afterAll(async () => {
    await new Promise((resolve) => rawServer?.close(resolve))
  })

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-trusted-main-egress-'))
    rawConnections = 0
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  for (const egressCase of [...BUILTIN_CASES, ...(RUNS_ON_BUN ? BUN_CASES : [])]) {
    it(`denies egress through ${egressCase.name}`, async () => {
      const extensionPackage = await writePackage({
        source: egressCase.source,
        origins: ['https://api.github.com'],
      })

      await expect(activateTrustedMainPackage(extensionPackage)).rejects.toThrow(egressCase.denial)
      expect(rawConnections).toBe(0)
    })
  }

  it('allows an HTTPS request to a declared hostname origin, including its DNS lookup', async () => {
    let requestCount = 0
    const server = await listenLocalHttpsServer({ onRequest: () => (requestCount += 1) })
    const origin = server.origin.replace('127.0.0.1', 'localhost')
    try {
      const extensionPackage = await writePackage({
        origins: [origin],
        source: activate(
          `await new Promise((resolve, reject) => {
            const req = request(${JSON.stringify(`${origin}/allowed`)}, { rejectUnauthorized: false }, (response) => {
              response.resume()
              response.on('end', resolve)
            })
            req.on('error', reject)
            req.end()
          })`,
          "import { request } from 'node:https'",
        ),
      })

      await activateTrustedMainPackage(extensionPackage)
      expect(requestCount).toBe(1)
    } finally {
      await server.close()
    }
  })

  it('denies a socket that an allowed request lets its response callback open', async () => {
    const server = await listenLocalHttpsServer({ onRequest: () => undefined })
    try {
      const extensionPackage = await writePackage({
        origins: [server.origin],
        source: activate(
          `await new Promise((resolve, reject) => {
            const req = request(${JSON.stringify(`${server.origin}/allowed`)}, { rejectUnauthorized: false }, (response) => {
              response.resume()
              try {
                connect(raw).on('error', reject).on('connect', resolve)
              } catch (error) {
                reject(error)
              }
            })
            req.on('error', reject)
            req.end()
          })`,
          "import { request } from 'node:https'\nimport { connect } from 'node:net'",
        ),
      })

      await expect(activateTrustedMainPackage(extensionPackage)).rejects.toThrow(RAW_SOCKET)
      expect(rawConnections).toBe(0)
    } finally {
      await server.close()
    }
  })
})
