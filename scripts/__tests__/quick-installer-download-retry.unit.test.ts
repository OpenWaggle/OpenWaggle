import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const RESOLUTION_START = '# BEGIN TESTABLE RELEASE RESOLUTION'
const RESOLUTION_END = '# END TESTABLE RELEASE RESOLUTION'
const ASSET_BODY = 'openwaggle-dmg-bytes'

function releaseResolution(source: string) {
  const start = source.indexOf(RESOLUTION_START)
  const end = source.indexOf(RESOLUTION_END)
  if (start < 0 || end <= start) throw new Error('Installer release resolution was not found.')
  return source.slice(start + RESOLUTION_START.length, end)
}

interface FlakyServer {
  readonly url: string
  readonly requestCount: () => number
  readonly close: () => Promise<void>
}

async function startServer(failures: number, failureStatus: number): Promise<FlakyServer> {
  let requests = 0
  const server = http.createServer((_request, response) => {
    requests += 1
    if (requests <= failures) {
      response.writeHead(failureStatus, { 'content-type': 'text/plain' })
      response.end('upstream error')
      return
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream' })
    response.end(ASSET_BODY)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address: AddressInfo | string | null = server.address()
  if (address === null || typeof address === 'string') throw new Error('Server has no TCP address.')
  return {
    url: `http://127.0.0.1:${address.port}/openwaggle-arm64.dmg`,
    requestCount: () => requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

async function downloadWithInstallerRetry(url: string) {
  const source = await fs.readFile('scripts/install.sh', 'utf8')
  const script = `set -euo pipefail
${releaseResolution(source)}
curl_with_retry -fsSL "$1"`
  return execFileAsync('bash', ['-c', script, 'installer-download-retry-test', url])
}

describe('quick installer download retry', () => {
  let server: FlakyServer | undefined

  afterEach(async () => {
    await server?.close()
    server = undefined
  })

  it('retries a transient GitHub 500 instead of aborting the install', async () => {
    server = await startServer(1, 500)

    const result = await downloadWithInstallerRetry(server.url)

    expect(result.stdout).toBe(ASSET_BODY)
    expect(server.requestCount()).toBe(2)
  })

  it('does not retry a permanent 404', async () => {
    server = await startServer(Number.POSITIVE_INFINITY, 404)

    await expect(downloadWithInstallerRetry(server.url)).rejects.toThrow()
    expect(server.requestCount()).toBe(1)
  })
})
