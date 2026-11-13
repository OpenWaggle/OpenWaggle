import type { Page } from '@playwright/test'

/**
 * Installs the Browser preview's engine through the app's own IPC, as opening a preview panel
 * does: on a fresh macOS install that downloads the CEF component. Resolves to `ready` or throws
 * the failed status, or a timeout after `timeoutMs`.
 */
export async function ensureBrowserEngineWithin(page: Page, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`The browser engine was not ready within ${String(timeoutMs)} ms.`)),
      timeoutMs,
    )
  })
  try {
    const status = await Promise.race([
      page.evaluate(async () => window.api.ensureBrowserEngine()),
      timeout,
    ])
    if (status.type !== 'ready') {
      throw new Error(`The browser engine could not be installed: ${JSON.stringify(status)}`)
    }
    return status
  } finally {
    clearTimeout(timer)
  }
}
