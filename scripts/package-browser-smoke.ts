import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { assertBrowserRuntimeResult } from './package-smoke-runtime-assertions'

const BROWSER_SMOKE_TIMEOUT_MS = 15_000
// Covers queued frames and short timers while adding only 250 ms per package-manager consumer.
const BROWSER_SMOKE_STABILIZATION_MS = 250
const LOOPBACK_HOST = '127.0.0.1'
const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404
const HTTP_OK = 200

function contentType(filePath: string) {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8'
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8'
  return 'application/octet-stream'
}

function staticFilePath(projectRoot: string, requestUrl: string | undefined) {
  const pathname = new URL(requestUrl ?? '/', `http://${LOOPBACK_HOST}`).pathname
  const relativePath = pathname === '/' ? 'browser-smoke.html' : decodeURIComponent(pathname.slice(1))
  const filePath = path.resolve(projectRoot, relativePath)
  const rootPrefix = `${path.resolve(projectRoot)}${path.sep}`

  return filePath.startsWith(rootPrefix) ? filePath : undefined
}

async function startStaticServer(projectRoot: string) {
  const server = http.createServer((request, response) => {
    const filePath = staticFilePath(projectRoot, request.url)
    if (filePath === undefined) {
      response.writeHead(HTTP_FORBIDDEN).end('Forbidden')
      return
    }

    void fs.readFile(filePath).then(
      (content) => {
        response.writeHead(HTTP_OK, { 'content-type': contentType(filePath) }).end(content)
      },
      () => {
        response.writeHead(HTTP_NOT_FOUND).end('Not found')
      },
    )
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, LOOPBACK_HOST, resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('Browser package smoke could not start its local server.')
  }

  return {
    url: `http://${LOOPBACK_HOST}:${String(address.port)}/browser-smoke.html`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

export async function assertStableBrowserRuntime(input: {
  readonly readStatus: () => Promise<string | null>
  readonly consoleErrors: readonly string[]
  readonly pageErrors: readonly string[]
  readonly stabilize: () => Promise<void>
}) {
  assertBrowserRuntimeResult({
    status: await input.readStatus(),
    consoleErrors: input.consoleErrors,
    pageErrors: input.pageErrors,
  })
  await input.stabilize()
  assertBrowserRuntimeResult({
    status: await input.readStatus(),
    consoleErrors: input.consoleErrors,
    pageErrors: input.pageErrors,
  })
}

function waitForBrowserStability() {
  return new Promise<void>((resolve) => setTimeout(resolve, BROWSER_SMOKE_STABILIZATION_MS))
}

export async function runPackageBrowserSmoke(projectRoot: string, executablePath?: string) {
  const server = await startStaticServer(projectRoot)

  try {
    const browser = await chromium.launch({ headless: true, executablePath })
    const consoleErrors: string[] = []
    const pageErrors: string[] = []

    try {
      const page = await browser.newPage()
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })
      page.on('pageerror', (error) => pageErrors.push(error.message))

      await page.goto(server.url, { waitUntil: 'load' })
      let waitError: unknown
      try {
        await page.waitForFunction(
          () =>
            ['passed', 'failed'].includes(
              document.documentElement.dataset.openwagglePackageSmoke ?? '',
            ),
          undefined,
          { timeout: BROWSER_SMOKE_TIMEOUT_MS },
        )
      } catch (error: unknown) {
        waitError = error
      }

      await assertStableBrowserRuntime({
        readStatus: () =>
          page.locator('html').getAttribute('data-openwaggle-package-smoke'),
        consoleErrors,
        pageErrors,
        stabilize: waitForBrowserStability,
      })
      if (waitError instanceof Error) throw waitError
      console.log('browser runtime smoke passed')
    } finally {
      await browser.close()
    }
  } finally {
    await server.close()
  }
}
