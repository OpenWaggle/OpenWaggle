import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser, type Page } from '@playwright/test'
import { AUTOMATION_IDENTITY_QUERY_PARAM } from '@shared/constants/electron-automation'
import {
  acquireQaLease,
  isOwnedQaTemporaryPath,
  parseQaLeaseMetadata,
  QA_CDP_PORT,
  type QaLease,
  recoverStaleQaLease,
  releaseQaLease,
} from './electron-qa-lease'
import { observeElectronQaChildExit, stopElectronQaChild } from './electron-qa-process'
import { captureRequiredQaEvidence, completeElectronQaShutdown } from './electron-qa-shutdown'
import { buildSafeElectronEnvironment } from './safe-electron-environment'

const QA_HOST = '127.0.0.1'
const CDP_TIMEOUT_MS = 60_000
const CDP_POLL_INTERVAL_MS = 100

interface QaConnection {
  readonly browser: Browser
  readonly page: Page
}

class QaCdpIdentityError extends Error {}

function errorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

export async function assertQaPortAvailable(port = QA_CDP_PORT) {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', (error) => reject(error))
    server.listen({ host: QA_HOST, port, exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }).catch((error: unknown) => {
    if (errorCode(error) === 'EADDRINUSE') {
      throw new Error(`Reserved Electron QA port ${port} is already occupied; Electron was not launched.`)
    }
    throw error
  })
}

function electronEnvironment(lease: QaLease): NodeJS.ProcessEnv {
  return buildSafeElectronEnvironment({
    ELECTRON_ENABLE_LOGGING: '1',
    OPENWAGGLE_AUTOMATION: '1',
    OPENWAGGLE_AUTOMATION_LEASE_TOKEN: lease.automationIdentity,
    OPENWAGGLE_AUTOMATION_PROJECT_PATH: lease.metadata.projectPath,
    OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
    OPENWAGGLE_USER_DATA_DIR: lease.metadata.profilePath,
  })
}

function startElectron(lease: QaLease) {
  return spawn(
    'pnpm',
    ['exec', 'electron-vite', 'dev', '--', `--remote-debugging-port=${QA_CDP_PORT}`],
    {
      cwd: lease.metadata.projectPath,
      detached: process.platform !== 'win32',
      env: electronEnvironment(lease),
      stdio: 'inherit',
    },
  )
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

export function qaPageMatchesAutomationIdentity(url: string, automationIdentity: string) {
  return new URL(url).searchParams.get(AUTOMATION_IDENTITY_QUERY_PARAM) === automationIdentity
}

async function connectWhenReady(
  child: ChildProcess,
  automationIdentity: string,
): Promise<QaConnection> {
  const endpoint = `http://${QA_HOST}:${QA_CDP_PORT}`
  const deadline = Date.now() + CDP_TIMEOUT_MS
  let browser: Browser | null = null

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Electron exited before the hidden QA preload bridge became ready.')
    }
    try {
      browser ??= await chromium.connectOverCDP(endpoint)
      const pages = browser.contexts().flatMap((context) => context.pages())
      for (const page of pages) {
        const preloadReady = await page
          .evaluate(() => Reflect.has(globalThis, 'api'))
          .catch(() => false)
        if (!preloadReady) continue
        if (qaPageMatchesAutomationIdentity(page.url(), automationIdentity)) {
          return { browser, page }
        }
        throw new QaCdpIdentityError(
          `CDP port ${QA_CDP_PORT} is owned by an Electron process with a different automation identity.`,
        )
      }
    } catch (error) {
      if (error instanceof QaCdpIdentityError) {
        await browser?.close().catch(() => undefined)
        throw error
      }
      // Electron or the renderer is not ready yet.
    }
    await delay(CDP_POLL_INTERVAL_MS)
  }
  await browser?.close().catch(() => undefined)
  throw new Error(`Timed out waiting for hidden Electron QA on ${endpoint}.`)
}

async function run() {
  const projectPath = await fs.realpath(process.cwd())
  const projectStats = await fs.stat(projectPath)
  if (!projectStats.isDirectory()) throw new Error(`QA project is not a directory: ${projectPath}`)

  await assertQaPortAvailable()
  const lease = await acquireQaLease(projectPath)
  const child = startElectron(lease)
  const childExitPromise = observeElectronQaChildExit(child)
  let connection: QaConnection | null = null
  let evidenceCaptured = false
  let shutdownPromise: Promise<void> | null = null

  const captureEvidence = async () => {
    if (evidenceCaptured) return
    const screenshotPath = path.join(lease.metadata.artifactsPath, 'qa-final.png')
    await captureRequiredQaEvidence(connection?.page ?? null, screenshotPath)
    evidenceCaptured = true
    console.info(`[electron-qa] screenshot: ${screenshotPath}`)
  }
  const shutdown = () => {
    shutdownPromise ??= completeElectronQaShutdown({
      captureEvidence: connection === null ? async () => undefined : captureEvidence,
      closeConnection: async () => connection?.browser.close(),
      stopChild: () => stopElectronQaChild(child),
    })
    return shutdownPromise
  }

  const onSignal = () => {
    process.exitCode = 0
    void shutdown().catch((error: unknown) => {
      console.error('[electron-qa] shutdown failed', error)
      process.exitCode = 1
    })
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  try {
    connection = await Promise.race([
      connectWhenReady(child, lease.automationIdentity),
      childExitPromise.then(() => {
        throw new Error('Electron exited before the hidden QA preload bridge became ready.')
      }),
    ])
    console.info(`[electron-qa] ready: http://${QA_HOST}:${QA_CDP_PORT}`)
    console.info(`[electron-qa] screenshots: ${lease.metadata.artifactsPath}`)
    const exitCode = await childExitPromise
    await shutdownPromise
    if (process.exitCode === undefined) process.exitCode = exitCode
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    await shutdown().catch((error: unknown) => {
      console.error('[electron-qa] shutdown failed', error)
      process.exitCode = 1
    })
    await releaseQaLease(lease)
  }
}

const entryPath = process.argv[1]
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void run().catch((error: unknown) => {
    console.error('[electron-qa] launch failed', error)
    process.exitCode = 1
  })
}

export { isOwnedQaTemporaryPath, parseQaLeaseMetadata, QA_CDP_PORT, recoverStaleQaLease }
