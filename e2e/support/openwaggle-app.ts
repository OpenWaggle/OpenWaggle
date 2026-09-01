import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, type ElectronApplication, type Page, test } from '@playwright/test'
import { shouldUseHiddenElectron } from '../../scripts/electron-launch-mode'
import { launchOpenWaggleElectron } from '../../scripts/playwright-electron-launcher'
import { MainWindowPage } from '../page-models/main-window.page'

let evidenceDirectoryPromise: Promise<string> | null = null
let evidenceSequence = 0
const QA_DIAGNOSTIC_TEXT_LIMIT = 1_000
const QA_SCREENSHOT_SETTLE_MS = 250
const QA_GRACEFUL_CLOSE_MS = 10_000
const QA_FORCED_CLOSE_WAIT_MS = 5_000

interface CleanupOptions {
  readonly forceProcessTermination?: boolean
}

async function completesWithin(operation: Promise<unknown>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation.then(() => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function evidenceDirectory() {
  evidenceDirectoryPromise ??= fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-e2e-evidence-')).then(
    (directory) => {
      console.info(`[electron-qa] screenshots: ${directory}`)
      return directory
    },
  )
  return evidenceDirectoryPromise
}

function evidenceName(prefix: string) {
  evidenceSequence += 1
  const safePrefix = prefix.replaceAll(/[^a-z0-9-]+/giu, '-').replaceAll(/^-|-$/gu, '')
  return `${String(evidenceSequence).padStart(3, '0')}-${safePrefix || 'electron-qa'}.png`
}

export class OpenWaggleApp {
  private constructor(
    readonly userDataDir: string,
    private app: ElectronApplication,
    private currentWindow: Page,
    readonly hidden: boolean,
    private readonly evidencePrefix: string,
    private readonly environmentOverrides: Readonly<Record<string, string>>,
  ) {}

  static async launch(
    prefix = 'openwaggle-e2e-',
    environmentOverrides: Readonly<Record<string, string>> = {},
  ): Promise<OpenWaggleApp> {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    const hidden = shouldUseHiddenElectron(test.info().project.use.headless)
    let app: ElectronApplication | null = null
    let window: Page | null = null
    try {
      app = await launchOpenWaggleElectron({ userDataDir, hidden, environmentOverrides })
      window = await app.firstWindow()
      const instance = new OpenWaggleApp(
        userDataDir,
        app,
        window,
        hidden,
        prefix,
        environmentOverrides,
      )
      await instance.mainWindow().waitUntilReady()
      return instance
    } catch (error) {
      if (window !== null) {
        const directory = await evidenceDirectory()
        const screenshotPath = path.join(directory, evidenceName(`${prefix}-launch-failure`))
        try {
          await window.screenshot({ path: screenshotPath })
          console.error(`[electron-qa] screenshot: ${screenshotPath}`)
        } catch (screenshotError) {
          console.error('[electron-qa] launch screenshot capture failed', screenshotError)
        }
        const diagnostics = await window
          .evaluate((textLimit) => ({
            bodyText: document.body.innerText.slice(0, textLimit),
            title: document.title,
            url: location.href,
          }), QA_DIAGNOSTIC_TEXT_LIMIT)
          .catch(() => null)
        console.error('[electron-qa] launch diagnostics', diagnostics)
      } else {
        console.error('[electron-qa] launch failed before Electron created a page')
      }
      await app?.close().catch(() => undefined)
      await fs.rm(userDataDir, { recursive: true, force: true })
      throw error
    }
  }

  async restart(): Promise<void> {
    await this.app.close()
    this.app = await launchOpenWaggleElectron({
      userDataDir: this.userDataDir,
      hidden: this.hidden,
      environmentOverrides: this.environmentOverrides,
    })
    this.currentWindow = await this.app.firstWindow()
    await this.mainWindow().waitUntilReady()
  }

  async close(): Promise<void> {
    await this.app.close()
  }

  async confirmNativeDialogs(response = 1): Promise<void> {
    await this.app.evaluate(({ dialog }, dialogResponse) => {
      dialog.showMessageBox = () =>
        Promise.resolve({
          response: dialogResponse,
          checkboxChecked: false,
        })
    }, response)
  }

  async cleanup(options: CleanupOptions = {}): Promise<void> {
    let evidenceError: unknown
    try {
      const directory = await evidenceDirectory()
      const screenshotPath = path.join(directory, evidenceName(this.evidencePrefix))
      await this.currentWindow.waitForTimeout(QA_SCREENSHOT_SETTLE_MS)
      await this.currentWindow.screenshot({ path: screenshotPath })
      console.info(`[electron-qa] screenshot: ${screenshotPath}`)
    } catch (error) {
      evidenceError = error
    } finally {
      let canRemoveUserData = true
      if (options.forceProcessTermination) {
        canRemoveUserData = await this.forceCloseForCleanup()
      } else {
        await this.closeForCleanup()
      }
      if (canRemoveUserData) {
        await fs.rm(this.userDataDir, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 250,
        })
      }
    }
    if (evidenceError !== undefined) {
      console.error('[electron-qa] final screenshot capture failed', evidenceError)
      expect.soft(evidenceError, 'Electron QA must capture its final screenshot').toBeUndefined()
    }
  }

  private async closeForCleanup(): Promise<void> {
    const closeOperation = this.close().catch(() => undefined)
    if (await completesWithin(closeOperation, QA_GRACEFUL_CLOSE_MS)) return

    console.warn('[electron-qa] graceful close timed out; terminating the temporary test app')
    this.terminateProcessTree()
    await completesWithin(closeOperation, QA_FORCED_CLOSE_WAIT_MS)
  }

  private async forceCloseForCleanup(): Promise<boolean> {
    console.warn('[electron-qa] exiting the temporary test app without running quit handlers')
    const closeEvent = this.app
      .waitForEvent('close', { timeout: QA_FORCED_CLOSE_WAIT_MS })
      .then(() => true)
      .catch(() => false)
    void this.app.evaluate(() => process.exit(0)).catch(() => undefined)
    if (await closeEvent) return true

    console.warn('[electron-qa] immediate app exit timed out; forcing shell closure')
    const forcedCloseEvent = this.app
      .waitForEvent('close', { timeout: QA_GRACEFUL_CLOSE_MS })
      .then(() => true)
      .catch(() => false)
    this.terminateProcessTree()
    const forcedClosed = await forcedCloseEvent
    if (!forcedClosed) {
      console.warn(`[electron-qa] retaining disposable profile ${this.userDataDir}`)
      this.releaseProcessHandles()
    }
    return forcedClosed
  }

  private terminateProcessTree(): void {
    const childProcess = this.app.process()
    if (process.platform === 'win32' && childProcess.pid) {
      const targetProcessId = String(childProcess.pid)
      const script = [
        `$targetProcessId = ${targetProcessId}`,
        '$allProcesses = @(Get-CimInstance Win32_Process)',
        '$tree = [System.Collections.Generic.List[int]]::new()',
        '$tree.Add($targetProcessId)',
        'for ($index = 0; $index -lt $tree.Count; $index++) {',
        '  $parentProcessId = $tree[$index]',
        '  foreach ($candidate in $allProcesses) {',
        '    $candidateId = [int]$candidate.ProcessId',
        '    if ([int]$candidate.ParentProcessId -eq $parentProcessId -and -not $tree.Contains($candidateId)) {',
        '      $tree.Add($candidateId)',
        '    }',
        '  }',
        '}',
        'for ($index = $tree.Count - 1; $index -ge 0; $index--) {',
        '  Stop-Process -Id $tree[$index] -Force -ErrorAction SilentlyContinue',
        '}',
      ].join('; ')
      const killer = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { stdio: 'ignore', windowsHide: true },
      )
      killer.unref()
      return
    }
    try {
      childProcess.kill('SIGKILL')
    } catch {
      // The process may have exited while cleanup was capturing evidence.
    }
  }

  private releaseProcessHandles(): void {
    const childProcess = this.app.process()
    childProcess.unref()
    for (const stream of childProcess.stdio) {
      if (stream === null) continue
      const unref = Reflect.get(stream, 'unref')
      if (typeof unref === 'function') Reflect.apply(unref, stream, [])
    }
  }

  async desktopState() {
    return this.app.evaluate(({ app, BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows()
      return {
        active: process.platform === 'darwin' ? app.isActive() : false,
        focused: windows.some((window) => window.isFocused()),
        visible: windows.some((window) => window.isVisible()),
      }
    })
  }

  async desktopPolicyProbe() {
    return this.app.evaluate(({ BaseWindow, BrowserWindow }) => {
      const probeWindow = new BrowserWindow({ show: false })
      // Electron's window classes are non-configurable exports. The repository
      // guard confines production construction to hidden-by-default helpers; this
      // real-runtime probe verifies their reveal methods still fail closed.
      const probeBaseWindow = new BaseWindow({ show: false })
      let focusBlocked = false
      let showBlocked = false
      let baseFocusBlocked = false
      let baseShowBlocked = false
      try {
        probeWindow.focus()
      } catch {
        focusBlocked = true
      }
      try {
        probeWindow.show()
      } catch {
        showBlocked = true
      }
      try {
        probeBaseWindow.focus()
      } catch {
        baseFocusBlocked = true
      }
      try {
        probeBaseWindow.show()
      } catch {
        baseShowBlocked = true
      }
      const constructedVisible = probeWindow.isVisible()
      const baseConstructedVisible = probeBaseWindow.isVisible()
      probeWindow.destroy()
      probeBaseWindow.destroy()
      return {
        baseConstructedVisible,
        baseFocusBlocked,
        baseShowBlocked,
        constructedVisible,
        focusBlocked,
        showBlocked,
      }
    })
  }

  window(): Page {
    return this.currentWindow
  }

  async resizeMainWindow(width: number, height: number): Promise<void> {
    await this.app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height),
      { width, height },
    )
  }

  /**
   * Emits a real `agent:event` from the main process.
   *
   * Uses the channel `stream-bridge` uses, so the renderer's own preload listener, stream reducer,
   * and projection all run. A pending authorization request and a live notification only exist
   * in-flight, so seeding the database cannot produce either; this is the only way to see the
   * request ribbon and the notification stack in the real application.
   */
  async emitAgentEvent(payload: { sessionId: string; event: unknown }): Promise<void> {
    await this.app.evaluate(({ BrowserWindow }, eventPayload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('agent:event', eventPayload)
      }
    }, payload)
  }

  async emitWorktreeLaunch(payload: { sessionId: string; launch: unknown }): Promise<void> {
    await this.app.evaluate(({ BrowserWindow }, launchPayload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('agent:worktree-launch', launchPayload)
      }
    }, payload)
  }

  mainWindow(): MainWindowPage {
    return new MainWindowPage(this.currentWindow)
  }
}
